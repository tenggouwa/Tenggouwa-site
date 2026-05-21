export default function About() {
  return (
    <div className="space-y-6 text-terminal-gray leading-relaxed">
      <h1 className="text-terminal-yellow text-2xl">
        <span className="text-terminal-pink">$ </span>whoami
      </h1>
      <pre className="text-sm border border-terminal-line/60 bg-terminal-panel/40 rounded-lg p-5 whitespace-pre-wrap">
{`name      : tenggouwa
roles     : engineer / tinkerer / 写诗的人
languages : python · typescript · go · 中文
stack     : react · fastapi · postgres · k8s · llm
hobbies   : 折腾 · 烹饪 · 摄影 · 读书 · 写小灵感
contact   : tenggouwa@gmail.com`}
      </pre>
      <p className="text-sm">
        这个站点是一个 monorepo：前端挂在 GitHub Pages，后端 FastAPI 部署在自己的服务器上。
        所有代码开源在
        <a
          className="text-terminal-green hover:underline ml-1"
          href="https://github.com/"
          target="_blank"
          rel="noreferrer"
        >
          github 仓库
        </a>
        。
      </p>
    </div>
  );
}
