"""Request-scoped Agent attachment parsing.

Attachments never enter AgentSession/AgentMessage storage. PDFs are text-extracted locally;
images are passed to an explicitly configured OpenAI-compatible vision provider.
"""

import base64
import binascii
import io
from dataclasses import dataclass

from pypdf import PdfReader

from .schema import AgentAttachment

MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_PDF_BYTES = 8 * 1024 * 1024
MAX_PDF_PAGES = 30
MAX_PDF_TEXT_CHARS = 24_000


class AttachmentError(ValueError):
    """An attachment is malformed or outside the safe request budget."""


@dataclass(frozen=True)
class PreparedAttachment:
    name: str
    media_type: str
    text: str | None = None
    data_url: str | None = None


def _decode(attachment: AgentAttachment) -> bytes:
    try:
        raw = base64.b64decode(attachment.data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise AttachmentError(f"附件 {attachment.name} 不是有效的 base64 数据") from exc
    limit = MAX_PDF_BYTES if attachment.media_type == "application/pdf" else MAX_IMAGE_BYTES
    if len(raw) > limit:
        raise AttachmentError(f"附件 {attachment.name} 超过 {limit // 1024 // 1024}MB 限制")
    return raw


def _pdf_text(name: str, raw: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(raw))
        if len(reader.pages) > MAX_PDF_PAGES:
            raise AttachmentError(f"PDF {name} 超过 {MAX_PDF_PAGES} 页限制")
        text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    except AttachmentError:
        raise
    except Exception as exc:  # pypdf has several parser-specific errors
        raise AttachmentError(f"PDF {name} 无法读取；请上传未加密、可复制文本的 PDF") from exc
    if not text:
        raise AttachmentError(f"PDF {name} 没有可提取文本；扫描件请先 OCR 后再上传")
    return text[:MAX_PDF_TEXT_CHARS]


def prepare_attachments(attachments: list[AgentAttachment], *, vision_enabled: bool) -> list[PreparedAttachment]:
    """Validate and normalize request attachments without retaining their bytes."""
    prepared: list[PreparedAttachment] = []
    for attachment in attachments:
        raw = _decode(attachment)
        if attachment.media_type == "application/pdf":
            prepared.append(
                PreparedAttachment(attachment.name, attachment.media_type, text=_pdf_text(attachment.name, raw))
            )
        else:
            if not vision_enabled:
                raise AttachmentError("图片分析暂未启用：生产环境尚未配置 vision provider；PDF 可正常上传")
            encoded = base64.b64encode(raw).decode("ascii")
            prepared.append(
                PreparedAttachment(
                    attachment.name, attachment.media_type, data_url=f"data:{attachment.media_type};base64,{encoded}"
                )
            )
    return prepared


def user_content(question: str, attachments: list[PreparedAttachment]) -> str | list[dict]:
    """Build an OpenAI-compatible user content value, retaining binary only for this request."""
    text_parts = [question.strip() or "请分析附件并回答。"]
    for attachment in attachments:
        if attachment.text is not None:
            text_parts.append(f"\n[PDF 附件：{attachment.name}]\n{attachment.text}\n[PDF 附件结束]")
    text = "\n".join(text_parts)
    images = [attachment for attachment in attachments if attachment.data_url]
    if not images:
        return text
    return [{"type": "text", "text": text}] + [
        {"type": "image_url", "image_url": {"url": attachment.data_url}} for attachment in images
    ]
