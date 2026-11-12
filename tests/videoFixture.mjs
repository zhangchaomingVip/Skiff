import { readFileSync } from "node:fs";
export const testVideo = () => Buffer.from(readFileSync(new URL("./fixtures/video.mp4.b64", import.meta.url), "utf8").trim(), "base64");
