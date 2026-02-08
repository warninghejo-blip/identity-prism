import asyncio
import os

from twitter_client import TwitterClient


async def main() -> None:
    client = TwitterClient()
    client.load_cookies()
    timeout = float(os.getenv('VERIFY_TIMEOUT', '8'))
    try:
        await asyncio.wait_for(client.verify_session(), timeout=timeout)
    except asyncio.TimeoutError:
        print("VERIFY_TIMEOUT")
        return
    except Exception as exc:
        print(f"VERIFY_FAILED: {exc}")
        return
    print("VERIFY_OK")


if __name__ == "__main__":
    asyncio.run(main())
