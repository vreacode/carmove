import unittest
from unittest.mock import patch

from . import app as server


class _PreviewResponse:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    def raise_for_status(self):
        pass

    async def aiter_bytes(self):
        yield b"preview-frame"


class PreviewModeTests(unittest.IsolatedAsyncioTestCase):
    async def check_mode(self, requested, forwarded):
        with patch.object(server.bridge.client, "stream", return_value=_PreviewResponse()) as stream:
            response = await server.api_stream_fallback(
                authorization=None, token=server.settings.auth_token, mode=requested
            )
            frames = [frame async for frame in response.body_iterator]
            self.assertEqual(frames, [b"preview-frame"])
            self.assertEqual(stream.call_args.kwargs["params"]["mode"], forwarded)

    async def test_annotated_preview_is_forwarded_without_replacing_it_with_raw_video(self):
        await self.check_mode("annotated", "annotated")

    async def test_visible_preview(self):
        await self.check_mode("visible_raw", "visible_raw")

    async def test_ir_preview(self):
        await self.check_mode("ir_raw", "ir_raw")

    async def test_unknown_mode_defaults_to_visible_preview(self):
        await self.check_mode("unknown", "visible_raw")
