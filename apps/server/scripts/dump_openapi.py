"""Dump the FastAPI app's OpenAPI schema to stdout as JSON.

Used by ``scripts/gen-api-types.sh`` to feed ``openapi-typescript``.
"""

import json

from main import main_app


def main() -> None:
    """Print the OpenAPI schema as JSON on stdout."""
    print(json.dumps(main_app.openapi(), ensure_ascii=False))


if __name__ == "__main__":
    main()
