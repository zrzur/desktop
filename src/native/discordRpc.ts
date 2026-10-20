import { Client } from "discord-rpc";

import { config } from "./config";

// internal state
let rpc: Client;

export async function initDiscordRpc() {
  if (!config.discordRpc) return;

  // clean up existing client if one exists
  rpc?.removeAllListeners();

  try {
    rpc = new Client({ transport: "ipc" });

    rpc.on("ready", () =>
      rpc.setActivity({
        state: "zarzour.cc",
        details: "Chatting with others",
        largeImageKey: "qr",
        largeImageText: "Join Zarzour!",
        buttons: [
          {
            label: "Join Zarzour",
            url: "https://zarzour.cc/",
          },
        ],
      }),
    );

    rpc.on("disconnected", reconnect);

    // Discord application ID for rich presence — replace when Zarzour Discord app exists (class E).
    rpc.login({ clientId: "872068124005007420" });
  } catch (err) {
    reconnect();
  }
}

const reconnect = () => setTimeout(() => initDiscordRpc(), 1e4);

export async function destroyDiscordRpc() {
  rpc?.destroy();
}
