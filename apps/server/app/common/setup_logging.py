import logging.config
import os
from logging import Logger

import yaml

import common


def setup_logging(config_path: str) -> Logger:
    logging_config_dict = load_logging_config(config_path)
    logging.config.dictConfig(logging_config_dict)
    logger = logging.getLogger()
    return logger


def load_logging_config(config_path: str) -> dict:
    """加载基于环境的日志配置。

    Args:
        config_path: 相对于 app/ 目录的日志配置文件路径

    Returns:
        当前环境对应的日志配置字典
    """
    log_env = common.config_manager.config.get("ENV", "dev")
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(base_dir, config_path)
    with open(path, encoding="utf-8") as f:
        logging_config = yaml.safe_load(f.read())
    if logging_config is None:
        raise FileNotFoundError(f"No {config_path} found.")

    environments = logging_config.get("environments", {})

    if log_env in environments:
        env_logging_config = environments[log_env]
    else:
        # Fallback: prod 环境使用 prod 配置，其他使用 dev
        fallback_env = "prod" if log_env.startswith("prod") else "dev"
        logging.warning(f"No logging configuration found for environment '{log_env}', using fallback: '{fallback_env}'")
        env_logging_config = environments.get(fallback_env)

        if env_logging_config is None:
            logging.critical(f"No configuration found for environment: {log_env} or fallback: {fallback_env}")
            raise ValueError(f"No configuration found for environment: {log_env} or fallback: {fallback_env}")

    return env_logging_config
