import os

import yaml
from dotenv import load_dotenv

# 获取自定义的 DOTENV_FILE 环境变量
dotenv_path = os.environ.get("DOTENV_FILE")
if dotenv_path:
    # 如果设置了 DOTENV_FILE，则使用它加载 .env 文件
    load_dotenv(dotenv_path, override=True)
else:
    # 否则使用默认行为
    load_dotenv(override=True)


class ConfigManager:
    """配置管理器：YAML 配置 + 环境变量合并加载。

    加载顺序：
        1. 读取 config/config.yml 作为基础配置
        2. 读取 config/config-{env}.yml 做深度覆盖
        3. 最后合并环境变量（环境变量 key 不能与 yml 中的 key 冲突）

    支持以下环境变量：
        ENV: 运行环境（dev、test、prod 等），必填
        CONFIG_DIR: 自定义配置目录路径（可选）
    """

    def __init__(self, env: str | None = None) -> None:
        self.env = env or os.environ.get("ENV")
        if self.env is None:
            raise ValueError(
                "The parameter 'env' and the environment variable 'ENV' cannot be both None at the same time."
            )
        self.config_dir = os.environ.get("CONFIG_DIR")
        self.conf_file_path = self._get_conf_file_path()
        self.config_cache = self._load_config()

    def _get_default_conf_file_path(self) -> str:
        if self.config_dir:
            return os.path.join(self.config_dir, "config.yml")
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return os.path.join(base_dir, "config/config.yml")

    def _get_conf_file_path(self) -> str:
        if self.config_dir:
            return os.path.join(self.config_dir, f"config-{self.env}.yml")
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return os.path.join(base_dir, f"config/config-{self.env}.yml")

    @staticmethod
    def _deep_update(source: dict, overrides: dict) -> dict:
        """递归深度更新嵌套字典。"""
        if overrides is None:
            return source

        for key, value in overrides.items():
            if isinstance(value, dict) and value:
                returned = ConfigManager._deep_update(source.get(key, {}), value)
                source[key] = returned
            else:
                source[key] = value
        return source

    def _load_config(self) -> dict:
        _config: dict = {}

        # 加载基础 config.yml
        default_conf_file_path = self._get_default_conf_file_path()
        if os.path.exists(default_conf_file_path):
            with open(default_conf_file_path, encoding="utf-8") as file:
                _config = yaml.safe_load(file) or {}

        # 加载 config-{env}.yml 并深度覆盖
        if os.path.exists(self.conf_file_path):
            with open(self.conf_file_path, encoding="utf-8") as file:
                env_config = yaml.safe_load(file)
                ConfigManager._deep_update(_config, env_config)

        # 合并环境变量，检测 key 冲突
        for key, value in os.environ.items():
            if key in _config:
                raise ValueError(f"Environment variable '{key}' conflicts with an existing configuration key.")
            _config[key] = value

        return _config

    def get_by_path(self, path: str, default: object | None = None) -> object:
        """通过 `a.b.c` 风格路径取值。"""
        keys = path.split(".")
        value = self.config_cache
        for key in keys:
            if isinstance(value, dict) and key in value:
                value = value[key]
            else:
                return default
        return value

    def get(self, key: str, default: object | None = None) -> object:
        return self.get_by_path(key, default)


config = ConfigManager()
