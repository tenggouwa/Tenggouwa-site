"""源注册表：加新源在这里登记一个 ingester 即可（未来 notes / code / web ...）。"""

from .base import Ingester, KBDoc, chunk_markdown, content_hash
from .blog import BlogIngester

INGESTERS: dict[str, Ingester] = {
    "blog": BlogIngester(),
}

__all__ = ["INGESTERS", "Ingester", "KBDoc", "chunk_markdown", "content_hash"]
