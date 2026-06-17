// 匿名身份：首次进来生成一个 uuid 存 localStorage，作为后端识别"每个人"的 device_id。
// 无任何账号体系，换浏览器即新人。

const KEY = 'tg_casino_device_id';

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
