import { useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputTag,
  Message,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
} from '@arco-design/web-react';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import { http } from '../lib/api';
import type { Post, PostCreate } from '../lib/types';

function slugify(title: string): string {
  // 只保留 ASCII：中文标题留个手输的余地（提示文案里说了）
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [form] = Form.useForm<PostCreate>();

  async function refresh() {
    setLoading(true);
    try {
      const data = (await http.get('/api/admin/posts')) as unknown as Post[];
      setPosts(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  }

  function openEdit(row: Post) {
    setEditing(row);
    form.setFieldsValue({
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      tags: row.tags,
      content: row.content,
    });
    setOpen(true);
  }

  // 创建模式下，slug 还没被用户改过时，跟着 title 自动联想
  function onTitleChange(value: string) {
    if (editing) return;
    const current = form.getFieldValue('slug') as string | undefined;
    if (current && current !== slugify((form.getFieldValue('title') as string) ?? '')) {
      return;
    }
    form.setFieldValue('slug', slugify(value));
  }

  async function submit() {
    const values = await form.validate();
    const payload: PostCreate = {
      ...values,
      tags: values.tags ?? [],
    };
    if (editing) {
      await http.put(`/api/admin/posts/${editing.id}`, payload);
      Message.success('已更新');
    } else {
      await http.post('/api/admin/posts', payload);
      Message.success('已创建');
    }
    setOpen(false);
    refresh();
  }

  async function remove(id: number) {
    await http.delete(`/api/admin/posts/${id}`);
    Message.success('已删除');
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">文章管理</h2>
        <Button type="primary" onClick={openCreate}>
          新建文章
        </Button>
      </div>
      <Table
        rowKey="id"
        loading={loading}
        data={posts}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: 'Slug', dataIndex: 'slug', width: 180 },
          { title: '标题', dataIndex: 'title' },
          {
            title: '标签',
            dataIndex: 'tags',
            width: 200,
            render: (tags: string[]) => (
              <Space>
                {tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </Space>
            ),
          },
          {
            title: '发布时间',
            dataIndex: 'published_at',
            width: 180,
            render: (v: string) => v?.slice(0, 16).replace('T', ' '),
          },
          {
            title: '操作',
            width: 160,
            render: (_: unknown, row: Post) => (
              <Space>
                <Button size="mini" onClick={() => openEdit(row)}>
                  编辑
                </Button>
                <Popconfirm title="确认删除？" onOk={() => remove(row.id)}>
                  <Button size="mini" status="danger">
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑文章' : '新建文章'}
        visible={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        style={{ width: 'min(1100px, 95vw)', top: 32 }}
        unmountOnExit
      >
        <Form form={form} layout="vertical">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item field="title" label="标题" rules={[{ required: true }]}>
              <Input
                placeholder="文章标题"
                onChange={onTitleChange}
              />
            </Form.Item>
            <Form.Item
              field="slug"
              label="Slug (URL 路径)"
              extra="只允许 a-z 0-9 -；中文标题需手输"
              rules={[
                { required: true },
                { match: /^[a-z0-9][a-z0-9-]*$/, message: '格式不对' },
              ]}
            >
              <Input placeholder="my-first-post" />
            </Form.Item>
          </div>
          <Form.Item field="summary" label="摘要">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 3 }} maxLength={500} showWordLimit />
          </Form.Item>
          <Form.Item field="tags" label="标签" triggerPropName="value">
            <InputTag placeholder="回车确认每个标签" allowClear />
          </Form.Item>
          <Form.Item
            field="content"
            label="正文 Markdown"
            rules={[{ required: true, message: '正文不能为空' }]}
            triggerPropName="value"
          >
            <MDEditor
              height={520}
              preview="live"
              data-color-mode="light"
              previewOptions={{
                // GFM 表格 / 任务列表已默认启用
              }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
