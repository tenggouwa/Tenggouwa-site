#!/bin/bash

set -e  # 遇到错误时退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# UV 命令变量（全局使用）
UV_CMD=""

# 从 pyproject.toml 中提取 Python 版本
get_python_version() {
    if [ -f "pyproject.toml" ]; then
        # 提取 requires-python 中的版本号
        local version
        version=$(grep -E "requires-python\s*=" pyproject.toml | sed -E 's/.*"==(.*)".*$/\1/')
        echo "$version"
    else
        echo ""
    fi
}

# 打印带颜色的消息
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查必要的工具
check_requirements() {
    print_status "检查必要工具..."

    # 检查 uv 是否在 PATH 中
    if command -v uv &> /dev/null; then
        UV_CMD="uv"
        print_success "找到 uv: $(which uv)"
    else
        # 检查常见的安装位置
        local uv_locations=(
            "/opt/homebrew/bin/uv"      # Homebrew on Apple Silicon
            "/usr/local/bin/uv"          # Homebrew on Intel Mac or standard location
            "$HOME/.local/bin/uv"        # Official installer
            "$HOME/.cargo/bin/uv"        # Cargo installation
            "/usr/bin/uv"                # System package manager
        )

        local found=false
        for location in "${uv_locations[@]}"; do
            if [ -x "$location" ]; then
                UV_CMD="$location"
                print_warning "uv 未在 PATH 中，但在 $location 找到"
                found=true
                break
            fi
        done

        if [ "$found" = false ]; then
            print_error "uv 未安装或未在 PATH 中"
            echo
            echo "请安装 uv："
            echo "  ${GREEN}Homebrew:${NC} brew install uv"
            echo "  ${GREEN}官方脚本:${NC} curl -LsSf https://astral.sh/uv/install.sh | sh"
            echo "  ${GREEN}Cargo:${NC} cargo install uv"
            echo
            echo "如果已安装，请将 uv 添加到 PATH："
            echo "  export PATH=\"/opt/homebrew/bin:\$PATH\"    # Homebrew (Apple Silicon)"
            echo "  export PATH=\"/usr/local/bin:\$PATH\"       # Homebrew (Intel Mac)"
            echo "  export PATH=\"\$HOME/.local/bin:\$PATH\"     # 官方安装脚本"
            echo "  export PATH=\"\$HOME/.cargo/bin:\$PATH\"     # Cargo"
            echo
            echo "将上述相应的行添加到 ~/.zshrc 或 ~/.bashrc 中"
            exit 1
        fi

        # 提示用户添加到 PATH
        echo
        print_warning "建议将 uv 添加到 PATH 以便于使用："
        case "$UV_CMD" in
            "/opt/homebrew/bin/uv")
                echo "  echo 'export PATH=\"/opt/homebrew/bin:\$PATH\"' >> ~/.zshrc"
                ;;
            "/usr/local/bin/uv")
                echo "  echo 'export PATH=\"/usr/local/bin:\$PATH\"' >> ~/.zshrc"
                ;;
            "$HOME/.local/bin/uv")
                echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
                ;;
            "$HOME/.cargo/bin/uv")
                echo "  echo 'export PATH=\"\$HOME/.cargo/bin:\$PATH\"' >> ~/.zshrc"
                ;;
        esac
        echo
    fi

    print_success "工具检查完成"
}

# 设置Python环境
setup_python_env() {
    local python_version
    python_version=$(get_python_version)

    if [ -z "$python_version" ]; then
        print_error "无法从 pyproject.toml 中读取 Python 版本"
        exit 1
    fi

    print_status "设置 Python $python_version 环境..."

    # 检查是否已安装指定版本
    if ! $UV_CMD python list --only-installed | grep -q "$python_version"; then
        print_status "安装 Python $python_version..."
        $UV_CMD python install "$python_version"
    else
        print_success "Python $python_version 已安装"
    fi

    # 固定项目使用的 Python 版本
    print_status "固定项目 Python 版本为 $python_version..."
    $UV_CMD python pin "$python_version"

    # 创建/重新创建虚拟环境
    print_status "创建虚拟环境..."
    if [ -d ".venv" ]; then
        print_warning "发现现有虚拟环境,将重新创建..."
        rm -rf .venv
    fi

    $UV_CMD venv

    # 同步依赖
    print_status "安装项目依赖..."
    $UV_CMD sync --all-extras

    print_success "Python 环境设置完成"
    print_status "Python 版本: $($UV_CMD run python --version)"
    print_status "虚拟环境路径: $(pwd)/.venv"
}

# 验证环境
verify_env() {
    print_status "验证环境设置..."

    local python_version
    python_version=$(get_python_version)
    local actual_version
    actual_version=$($UV_CMD run python --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')

    if [ "$actual_version" = "$python_version" ]; then
        print_success "Python 版本验证通过: $actual_version"
    else
        print_error "Python 版本不匹配! 期望: $python_version, 实际: $actual_version"
        exit 1
    fi

    # 检查虚拟环境
    if [ -f ".venv/bin/python" ]; then
        print_success "虚拟环境创建成功"
    else
        print_error "虚拟环境创建失败"
        exit 1
    fi
}

# 激活虚拟环境
activate_venv() {
    local shell_name
    shell_name=$(basename "$SHELL")
    local shell_path="$SHELL"

    print_status "检测到 Shell: $shell_name ($shell_path)"

    case "$shell_name" in
        bash)
            print_status "正在为 bash 激活虚拟环境..."
            local temp_rc
            temp_rc=$(mktemp)
            cat > "$temp_rc" << 'EOF'
[ -f ~/.bashrc ] && source ~/.bashrc
[ -f ~/.bash_profile ] && source ~/.bash_profile
source .venv/bin/activate
trap "rm -f $temp_rc" EXIT
export PS1="(.venv) $PS1"
EOF
            exec bash --rcfile "$temp_rc"
            ;;

        zsh)
            print_status "正在为 zsh 激活虚拟环境..."
            local has_omz=false
            if [ -d "$HOME/.oh-my-zsh" ] && grep -q "oh-my-zsh" ~/.zshrc 2>/dev/null; then
                has_omz=true
            fi

            local temp_dir
            temp_dir=$(mktemp -d)
            local temp_zshrc="$temp_dir/.zshrc"

            if [ "$has_omz" = true ]; then
                cat > "$temp_zshrc" << EOF
source ~/.zshrc
source .venv/bin/activate
zshexit() { rm -rf "$temp_dir"; }
EOF
            else
                cat > "$temp_zshrc" << EOF
[ -f ~/.zshrc ] && source ~/.zshrc
source .venv/bin/activate
if [[ -n "\$VIRTUAL_ENV" ]] && [[ -z "\$VIRTUAL_ENV_DISABLE_PROMPT" ]]; then
    export PROMPT="(.venv) \$PROMPT"
fi
zshexit() { rm -rf "$temp_dir"; }
EOF
            fi

            ZDOTDIR="$temp_dir" exec zsh
            ;;

        fish)
            print_status "正在为 fish 激活虚拟环境..."
            exec fish -C "source .venv/bin/activate.fish"
            ;;

        *)
            print_warning "未知的 Shell 类型: $shell_name"
            echo "请手动激活虚拟环境："
            echo "  对于 bash/zsh/sh: source .venv/bin/activate"
            echo "  对于 fish:        source .venv/bin/activate.fish"
            echo "  对于 csh/tcsh:    source .venv/bin/activate.csh"
            ;;
    esac
}

# 显示使用提示
show_usage() {
    echo
    print_success "环境设置完成!"
    echo
    echo "使用说明:"
    echo "  激活环境: source .venv/bin/activate"
    echo "  或使用:   uv run python your_script.py"
    echo "  安装依赖: uv add package_name"
    echo "  运行应用: uv run python app/main.py"
    echo
    print_status "Python 版本: $(get_python_version)"
    print_status "项目路径: $(pwd)"
    echo

    # 询问是否自动激活虚拟环境
    read -p "是否自动激活虚拟环境？[Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
        activate_venv
    else
        print_status "你可以手动激活虚拟环境: source .venv/bin/activate"
    fi
}

# 主函数
main() {
    echo "Python 环境设置脚本"
    echo "========================"

    check_requirements
    setup_python_env
    verify_env
    show_usage
}

# 运行主函数
main "$@"
