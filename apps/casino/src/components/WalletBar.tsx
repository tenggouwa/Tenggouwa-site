// 顶部钱包条：显示当前积分余额 + 全历史净值；余额为 0 时给"重领"按钮。
// 积分纯计数，无任何充值/提现含义。

import { useEffect, useState } from 'react';
import { claim, fetchWallet, getWalletCache, setWallet, subscribeWallet } from '../lib/casino';
import type { Wallet } from '../lib/types';

export default function WalletBar() {
  const [wallet, setLocal] = useState<Wallet | null>(getWalletCache());
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    const unsub = subscribeWallet(setLocal);
    if (!getWalletCache()) {
      fetchWallet()
        .then(setWallet)
        .catch(() => {});
    }
    return unsub;
  }, []);

  const onReset = async () => {
    setClaiming(true);
    try {
      setWallet(await claim());
    } finally {
      setClaiming(false);
    }
  };

  const broke = wallet != null && wallet.balance <= 0;

  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="text-terminal-gray/70">
        积分{' '}
        <span className={broke ? 'text-terminal-red' : 'text-terminal-yellow'}>{wallet ? wallet.balance : '—'}</span>
      </span>
      {wallet && (
        <span className="hidden text-terminal-gray/60 sm:inline">
          净值{' '}
          <span className={wallet.net < 0 ? 'text-terminal-red' : 'text-terminal-green'}>
            {wallet.net >= 0 ? '+' : ''}
            {wallet.net}
          </span>
        </span>
      )}
      <button
        onClick={onReset}
        disabled={claiming}
        title="把积分重置回 1000（积分纯计数，重置次数会记录）"
        className={
          'rounded border px-2 py-0.5 text-xs transition disabled:opacity-50 ' +
          (broke
            ? 'border-terminal-green/70 text-terminal-green shadow-glow hover:bg-terminal-green/10'
            : 'border-terminal-line text-terminal-gray/70 hover:border-terminal-green/50 hover:text-terminal-green')
        }
      >
        {claiming ? '重置中…' : broke ? '重置 +1000' : '重置'}
      </button>
    </div>
  );
}
