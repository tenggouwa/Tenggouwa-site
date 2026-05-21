import { useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Message,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
} from '@arco-design/web-react';
import { http } from '../lib/api';
import type { Post, PostCreate } from '../lib/types';

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

  async function submit() {
    const values = await form.validate();
    const payload: PostCreate = {
      ...values,
      tags: typeof values.tags === 'string'
        ? (values.tags as unknown as string).split(',').map((t) => t.trim()).filter(Boolean)
        : values.tags,
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
        style={{ width: 720 }}
      >
        <Form form={form} layout="vertical">
          <Form.Item field="slug" label="Slug" rules={[{ required: true }]}>
            <Input placeholder="my-first-post" />
          </Form.Item>
          <Form.Item field="title" label="标题" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item field="summary" label="摘要">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 3 }} />
          </Form.Item>
          <Form.Item
            field="tags"
            label="标签（逗号分隔）"
            normalize={(v: unknown) =>
              Array.isArray(v) ? v.join(',') : (v as string | undefined)
            }
          >
            <Input placeholder="react, vite" />
          </Form.Item>
          <Form.Item field="content" label="正文 Markdown" rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 10, maxRows: 20 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
