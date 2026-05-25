---
slug: shells-rcfile
title: 把 shell 调成你的样子：.bashrc / .zshrc / PATH / alias / 函数
summary: Linux 系列第 10 篇。同样是终端，老司机的 shell 看起来"懂他"——按 Tab 就补完路径、敲 `g` 就是 `git`、错命令有提示。这一篇拆开 shell 启动加载的文件链、PATH 是什么、怎么用 alias 和函数把你常用操作调成肌肉记忆。
tags: [linux, linux-series, shell, bashrc, zshrc, dotfiles]
published_at: 2026-06-23
---

> 这是 Linux 系列的第 10 篇——**日常 shell 工具章节的最后一篇**。前几篇讲了"shell 能干什么"，这一篇讲"shell 怎么调成你的"。

## 0. 同样的终端，老司机的样子

新开终端，新手看到的：

```
user@host:~$ _
```

老司机看到的（举例）：

```
~/proj/web (main)● 12:34 ❯ _
```

带 git 分支显示、有未提交标记、知道你在 main 上、提示符是 `❯` 而不是 `$`、Tab 补全自动展开你的项目名……这些都不是装的什么神器，全是 shell 配置文件里几十行设定。

学完这篇你能：
- 知道 `.bashrc / .zshrc / .profile` 各自什么时候被加载
- 把常用命令调成 2-3 个字母的 alias
- 写小函数解决"alias 装不下"的场景
- 调出现代 prompt + 自动补全 + 历史增强

---

## 1. shell 启动时到底加载了什么

不同 shell、不同登录方式，加载的文件**不一样**。这是新手最容易踩坑的地方。

### bash 的加载顺序

启动方式分两种：

**A. 登录 shell**（SSH 登录、tty 登录、`bash -l`）：

```
/etc/profile
  → /etc/bash.bashrc（Debian 系把这个 source 进 profile）
  → ~/.bash_profile（**找到一个就停**）
    或 ~/.bash_login
    或 ~/.profile
```

**B. 交互式非登录 shell**（在已登录 session 里再开终端 / `bash`）：

```
/etc/bash.bashrc
  → ~/.bashrc
```

为什么这么坑？因为 SSH 进来的是**登录 shell**（A 路径），不读 `.bashrc`；本地终端开新 tab 是**非登录**（B 路径），只读 `.bashrc`。

**约定俗成的解法**：在 `~/.bash_profile` 里加一行：

```bash
[ -f ~/.bashrc ] && source ~/.bashrc
```

这样无论哪条路径，`~/.bashrc` 都被加载。

### zsh 更清晰

```
/etc/zshenv → ~/.zshenv           # 所有 zsh 进程，最早加载
/etc/zprofile → ~/.zprofile       # 登录 shell
/etc/zshrc → ~/.zshrc             # 交互 shell（最常用）
/etc/zlogin → ~/.zlogin           # 登录 shell（在 zshrc 之后）
```

**90% 的人改 `~/.zshrc` 就够了**。zsh 不像 bash 有"找到一个就停"的诡异规则。

### 简单建议

新手别纠结，按这个来：

- **bash**：所有配置写在 `~/.bashrc`，然后让 `~/.bash_profile` source 它
- **zsh**：所有配置写在 `~/.zshrc`
- 想知道当前 shell 是哪个：`echo $SHELL` 或 `echo $0`

---

## 2. PATH：shell 怎么找到一个命令

```bash
$ echo $PATH
/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/home/me/.local/bin
```

冒号分隔的目录列表。你敲 `ls` 时 shell **按顺序**在这些目录里找 `ls` 可执行文件——找到的第一个就跑。

### 加自己的目录到 PATH

```bash
# ~/.bashrc 或 ~/.zshrc 里加
export PATH="$HOME/.local/bin:$PATH"
```

注意 `$HOME/.local/bin` 放**前面**——这样你装的版本会覆盖系统版本（比如装了新版 Python 但系统也有旧的）。

### 检查命令到底跑的是哪个

```bash
$ which python
/usr/bin/python                   # 这一个会被跑

$ type python                     # type 比 which 更聪明
python is /usr/bin/python

$ type ls
ls is aliased to `ls --color=auto`   # 哦原来 ls 是个 alias

$ command -v node                 # 脚本里查"有没有装这个命令"
/usr/local/bin/node
```

---

## 3. alias：缩写常用命令

最简单的 shell 加速器：

```bash
# 在 ~/.bashrc 或 ~/.zshrc 里
alias ll='ls -lah'
alias la='ls -A'
alias ..='cd ..'
alias ...='cd ../..'
alias g='git'
alias gs='git status'
alias gd='git diff'
alias gl='git log --oneline --graph --decorate -20'
alias gp='git push'
alias gc='git commit'

# 让常用工具默认带参数
alias grep='grep --color=auto'
alias diff='diff --color=auto'
alias rm='rm -i'                  # 永远问一下（安全）

# 平台无关
alias open='xdg-open'             # Linux 上模拟 mac 的 open

# 看大文件夹
alias dush='du -sh -- */ | sort -hr'

# 让 docker / kubectl 更短
alias d='docker'
alias dc='docker compose'
alias k='kubectl'
```

**约定**：

- 一个字母 alias 给最高频（`g` = git，`k` = kubectl）
- 两个字母 alias 给次高频（`gs` = git status）
- 改完保存，**`source ~/.zshrc`** 或者**新开终端**才生效

### alias 装不下的时候

alias 不支持**参数**（参数会原样追加到末尾）。需要参数的时候用**函数**。

---

## 4. 函数：alias 的进阶

```bash
# ~/.zshrc 里

# mkdir 之后立刻进去（懒人最爱）
mkcd() {
  mkdir -p "$1" && cd "$1"
}

# 解压什么文件都用一个命令
extract() {
  case "$1" in
    *.tar.gz|*.tgz)  tar xzf "$1" ;;
    *.tar.bz2|*.tbz) tar xjf "$1" ;;
    *.tar.xz)        tar xJf "$1" ;;
    *.tar)           tar xf "$1" ;;
    *.zip)           unzip "$1" ;;
    *.gz)            gunzip "$1" ;;
    *)               echo "不认识的格式: $1" ;;
  esac
}

# 快速找进程
pf() {
  ps aux | grep -i "$1" | grep -v grep
}

# git 一键 commit + push
gcp() {
  git add -A && git commit -m "$*" && git push
}
# 用法: gcp "fix typo"

# 列出当前目录大小 top N
top_size() {
  du -sh -- */ 2>/dev/null | sort -hr | head -"${1:-10}"
}

# 临时启个静态 http server
serve() {
  python3 -m http.server "${1:-8000}"
}
```

`"$1"`、`"$*"` 是函数参数。`${1:-10}` 的意思是"取参数 1，没传就用 10"。

---

## 5. 历史增强：少敲一半的键

```bash
# bash / zsh 都支持的快捷键
↑              # 上一条
Ctrl+R         # 反向搜索（开始打字 → 自动匹配历史）
!!             # 上一条整条
sudo !!        # 用 sudo 重跑上一条（特别好用）
!$             # 上一条的最后一个参数
!*             # 上一条的全部参数
^old^new       # 把上一条里 old 换成 new 再跑一遍

# 配置增强（写进 rc）
export HISTSIZE=100000          # 内存里保留多少
export HISTFILESIZE=200000      # 文件里保留多少
export HISTCONTROL=ignoreboth:erasedups  # 去重 + 不存空行 + 重复的清掉旧的

# zsh 特有
setopt SHARE_HISTORY            # 多终端实时共享历史
setopt HIST_IGNORE_DUPS
setopt HIST_REDUCE_BLANKS
```

### `Ctrl+R` 是杀手锏

```
(reverse-i-search)`dock': docker compose -f docker-compose.prod.yml ...
```

敲 `dock`，shell 自动反向找上次包含 `dock` 的命令。一直 Ctrl+R 翻更早的。**学会这个能让你日常少敲 70% 的键**。

---

## 6. 自动补全：Tab 不要白按

bash 默认 Tab 补完命令名和文件名。**装上 bash-completion 后 Tab 能补**：

- git 的子命令和分支名（`git ch<Tab>` → `git checkout`）
- ssh 的 host（`ssh dev<Tab>` 从 `~/.ssh/config` 补出来）
- docker 的容器名
- apt 的包名

```bash
# Debian/Ubuntu
$ sudo apt install bash-completion
```

zsh 用户：**直接上 [oh-my-zsh](https://ohmyz.sh/)**：

```bash
$ sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

装完默认就有：

- git / docker / kubectl 等几百个插件的 Tab 补全
- 几十个 prompt 主题
- 别人沉淀的 alias 集合

我自己装的几个插件（在 `~/.zshrc` 的 `plugins=(...)` 里加）：

```bash
plugins=(git docker kubectl zsh-autosuggestions zsh-syntax-highlighting)
```

- `zsh-autosuggestions`：基于历史**实时显示灰色建议**，按 → 接受
- `zsh-syntax-highlighting`：命令对错实时红绿提示

---

## 7. Prompt：第一眼的体验

`PS1`（bash）/ `PROMPT`（zsh）控制提示符。可以无穷折腾，但实际推荐**装一个现成的**：

### Starship（推荐）

跨 shell、纯 Rust、零配置就好看，**支持 bash / zsh / fish / pwsh**：

```bash
$ curl -sS https://starship.rs/install.sh | sh

# 在 ~/.bashrc 末尾
eval "$(starship init bash)"

# 在 ~/.zshrc 末尾
eval "$(starship init zsh)"
```

新开终端就能看到：

```
~/proj/web on  main [!] via  18.0.0
❯
```

带 git 分支、未提交标记、Node 版本、当前路径、各种缩进——全自动。

---

## 8. 一个能直接抄的 `.zshrc` 起手式

```bash
# === PATH ===
export PATH="$HOME/.local/bin:$PATH"
export PATH="/usr/local/go/bin:$PATH"
export EDITOR="vim"           # crontab、git commit 等用
export LANG="en_US.UTF-8"

# === 历史 ===
HISTSIZE=100000
SAVEHIST=200000
HISTFILE="$HOME/.zsh_history"
setopt SHARE_HISTORY HIST_IGNORE_DUPS HIST_REDUCE_BLANKS

# === alias ===
alias ll='ls -lah'
alias ..='cd ..'
alias g='git'
alias gs='git status'
alias gd='git diff'
alias gl='git log --oneline --graph --decorate -20'
alias d='docker'
alias dc='docker compose'

# === 函数 ===
mkcd() { mkdir -p "$1" && cd "$1"; }
serve() { python3 -m http.server "${1:-8000}"; }

# === prompt ===
eval "$(starship init zsh)"

# === oh-my-zsh（如果用）===
# source $HOME/.oh-my-zsh/oh-my-zsh.sh
```

抄进 `~/.zshrc`，`source ~/.zshrc`，立刻焕然一新。

---

## 9. 把你的 dotfiles 管起来

调出心仪的配置后，**绝对要 git 管起来**——不然换机器一切重来。

简单方案：

```bash
# 建一个 ~/dotfiles 仓库
$ mkdir ~/dotfiles && cd ~/dotfiles
$ git init

# 把配置移进来，原位置改成 symlink
$ mv ~/.zshrc .zshrc
$ ln -s ~/dotfiles/.zshrc ~/.zshrc

# 同样处理 .gitconfig / .vimrc / .ssh/config（小心 ssh key 别上传）/ tmux.conf

# 推到 GitHub 私库
$ git push
```

换新机器：

```bash
$ git clone <your-repo> ~/dotfiles
$ ln -s ~/dotfiles/.zshrc ~/.zshrc
$ ln -s ~/dotfiles/.gitconfig ~/.gitconfig
# ...
```

5 分钟从零搭起你熟悉的环境。

更优雅的：用 [chezmoi](https://chezmoi.io/) 或 [yadm](https://yadm.io/) 这种 dotfiles 管理工具，自动处理 symlink、模板（按机器名区分 work / home 配置）等。

---

## 10. 现在做一件事

不要现在就装一堆插件。**先做最小的两件事**：

1. 在 `~/.bashrc` / `~/.zshrc` 里加 3-5 个最常用的 alias（你 `history | awk '{print $2}' | sort | uniq -c | sort -rn | head` 看看你自己最高频的命令是什么）
2. 配 `HISTSIZE=100000` + Ctrl+R 反向搜历史

**这两件事每天节省你的时间，能给你装其他酷工具的动力**。

剩下的（starship、autosuggestions、tmux 等）等你有需要再装，别一次性堆 30 个工具结果记不住快捷键。

---

> **下一篇**：[permissions](permissions)——`rwx`、`chmod 755` 这些数字到底从哪来的，suid / sgid / sticky 是什么，为什么有时候 `sudo` 都不让你写某文件。
