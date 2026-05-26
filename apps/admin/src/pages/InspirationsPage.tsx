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
} from '@arco-design/web-react';
import { http } from '../lib/api';
import type { Inspiration, InspirationCreate, InspirationListPage } from '../lib/types';

const PAGE_SIZE = 20;

export default function InspirationsPage() {
  const [list, setList] = useState<Inspiration[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<InspirationCreate>();

  async function refresh(p: number) {
    setLoading(true);
    try {
      const data = (await http.get(
        `/api/admin/inspirations?limit=${PAGE_SIZE}&offset=${(p - 1) * PAGE_SIZE}`,
      )) as unknown as InspirationListPage;
      setList(data.items);
      setTotal(data.total);
      setPage(p);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(1);
  }, []);

  async function submit() {
    const values = await form.validate();
    await http.post('/api/admin/inspirations', values);
    Message.success('已添加');
    setOpen(false);
    form.resetFields();
    refresh(1);
  }

  async function remove(id: number) {
    await http.delete(`/api/admin/inspirations/${id}`);
    Message.success('已删除');
    refresh(page);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold">小灵感</h2>
        <Button type="primary" onClick={() => setOpen(true)}>
          记一条
        </Button>
      </div>
      <Table
        rowKey="id"
        loading={loading}
        data={list}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          onChange: (p) => refresh(p),
          showTotal: true,
        }}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '内容', dataIndex: 'content' },
          { title: '心情', dataIndex: 'mood', width: 120 },
          {
            title: '时间',
            dataIndex: 'created_at',
            width: 180,
            render: (v: string) => v?.slice(0, 16).replace('T', ' '),
          },
          {
            title: '操作',
            width: 100,
            render: (_: unknown, row: Inspiration) => (
              <Space>
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
        title="记一条灵感"
        visible={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
      >
        <Form form={form} layout="vertical">
          <Form.Item field="content" label="内容" rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
          </Form.Item>
          <Form.Item field="mood" label="心情（可选）">
            <Input placeholder="😄 / 🤔 / 文字皆可" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
