import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/redgifs/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { streamRedgifsFile } = await import("@/lib/reddit/reddit.server");
        return streamRedgifsFile(params.id, request);
      },
    },
  },
});
