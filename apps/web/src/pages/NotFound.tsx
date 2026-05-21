import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="space-y-4 font-mono">
      <h1 className="text-terminal-pink text-2xl">404 · no such file or directory</h1>
      <pre className="text-sm text-terminal-gray">
{`$ cd /404
zsh: cd: no such file or directory: /404`}
      </pre>
      <Link to="/" className="text-terminal-green hover:underline">
        ← cd ~
      </Link>
    </div>
  );
}
