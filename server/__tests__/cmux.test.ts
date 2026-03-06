import { test, expect, describe } from "bun:test";
import { createCmuxService, type SocketConnector } from "../cmux.ts";

function createFakeConnector(): {
  connector: SocketConnector;
  sent: { method: string; params: Record<string, unknown> }[];
} {
  const sent: { method: string; params: Record<string, unknown> }[] = [];
  const connector: SocketConnector = async (_path) => ({
    async send(method, params = {}) {
      sent.push({ method, params });
      return { ok: true };
    },
    close() {},
  });
  return { connector, sent };
}

describe("createCmuxService", () => {
  test("sendText sends surface.send_text", async () => {
    const { connector, sent } = createFakeConnector();
    const cmux = createCmuxService(connector, "/tmp/test.sock");
    await cmux.sendText("hello world");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe("surface.send_text");
    expect(sent[0]?.params).toEqual({ text: "hello world" });
  });

  test("sendText with surfaceId", async () => {
    const { connector, sent } = createFakeConnector();
    const cmux = createCmuxService(connector, "/tmp/test.sock");
    await cmux.sendText("hello", "surface:123");
    expect(sent[0]?.params).toEqual({ text: "hello", surface_id: "surface:123" });
  });

  test("notify sends notification.create", async () => {
    const { connector, sent } = createFakeConnector();
    const cmux = createCmuxService(connector, "/tmp/test.sock");
    await cmux.notify("Title", "Body", "Sub");
    expect(sent[0]?.method).toBe("notification.create");
    expect(sent[0]?.params).toEqual({ title: "Title", body: "Body", subtitle: "Sub" });
  });

  test("notify without subtitle", async () => {
    const { connector, sent } = createFakeConnector();
    const cmux = createCmuxService(connector, "/tmp/test.sock");
    await cmux.notify("Title", "Body");
    expect(sent[0]?.params).toEqual({ title: "Title", body: "Body" });
  });

  test("sendComment formats and sends", async () => {
    const { connector, sent } = createFakeConnector();
    const cmux = createCmuxService(connector, "/tmp/test.sock");
    await cmux.sendComment("src/index.ts", 42, 42, "Fix this bug");
    expect(sent[0]?.method).toBe("surface.send_text");
    expect(sent[0]?.params.text).toBe("src/index.ts:42\nFix this bug\n");
  });

  test("sendCommand appends newline", async () => {
    const { connector, sent } = createFakeConnector();
    const cmux = createCmuxService(connector, "/tmp/test.sock");
    await cmux.sendCommand("git status");
    expect(sent[0]?.params.text).toBe("git status\n");
  });

  test("listSurfaces sends surface.list", async () => {
    const { connector, sent } = createFakeConnector();
    const cmux = createCmuxService(connector, "/tmp/test.sock");
    await cmux.listSurfaces();
    expect(sent[0]?.method).toBe("surface.list");
  });
});
