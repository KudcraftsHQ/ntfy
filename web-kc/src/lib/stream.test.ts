import { describe, expect, it } from "vitest";
import { isSyncEvent, parseLine, parseNdjson, retryDelay, sequenceId } from "./stream";

describe("parseLine", () => {
  it("parses a message event", () => {
    const m = parseLine('{"id":"a1","time":1700000000,"event":"message","topic":"facemap-orders","title":"Hi","message":"x"}');
    expect(m?.id).toBe("a1");
    expect(m?.topic).toBe("facemap-orders");
  });
  it("ignores keepalive, open and poll_request events", () => {
    expect(parseLine('{"id":"k","time":1,"event":"keepalive","topic":"t"}')).toBeNull();
    expect(parseLine('{"id":"o","time":1,"event":"open","topic":"t"}')).toBeNull();
    expect(parseLine('{"id":"p","time":1,"event":"poll_request","topic":"t"}')).toBeNull();
  });
  it("keeps delete and clear events", () => {
    expect(parseLine('{"id":"d","time":1,"event":"message_delete","topic":"t","sequence_id":"s"}')?.event).toBe("message_delete");
    expect(parseLine('{"id":"c","time":1,"event":"message_clear","topic":"t","sequence_id":"s"}')?.event).toBe("message_clear");
  });
  it("rejects junk and incomplete objects", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("not json")).toBeNull();
    expect(parseLine("42")).toBeNull();
    expect(parseLine('{"event":"message","topic":"t"}')).toBeNull();
  });
});

describe("parseNdjson", () => {
  it("parses a poll body with blank lines and keepalives", () => {
    const body = [
      '{"id":"1","time":10,"event":"message","topic":"a"}',
      "",
      '{"id":"k","time":11,"event":"keepalive","topic":"a"}',
      '{"id":"2","time":12,"event":"message","topic":"b"}',
      "",
    ].join("\n");
    expect(parseNdjson(body).map((m) => m.id)).toEqual(["1", "2"]);
  });
});

describe("helpers", () => {
  it("sequenceId falls back to id", () => {
    expect(sequenceId({ id: "x", time: 1, event: "message", topic: "t" })).toBe("x");
    expect(sequenceId({ id: "x", sequence_id: "s", time: 1, event: "message", topic: "t" })).toBe("s");
  });
  it("detects sync events on the sync topic", () => {
    expect(isSyncEvent({ id: "1", time: 1, event: "message", topic: "st_x", message: '{"event":"sync"}' })).toBe(true);
    expect(isSyncEvent({ id: "1", time: 1, event: "message", topic: "st_x", message: "hello" })).toBe(false);
  });
  it("backs off and caps", () => {
    expect(retryDelay(0)).toBe(1);
    expect(retryDelay(100)).toBe(60);
  });
});
