"""RQ worker process: `python -m upsell_poc.worker`."""

from __future__ import annotations

from redis import Redis
from rq import Queue, Worker

from upsell_poc.config import get_settings
from upsell_poc.logging_setup import setup_logging


def main() -> None:
    settings = get_settings()
    setup_logging(settings.log_level)
    connection = Redis.from_url(settings.redis_url)
    worker = Worker([Queue(settings.queue_name, connection=connection)], connection=connection)
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
