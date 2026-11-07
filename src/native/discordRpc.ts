import { Client } from "discord-rpc";

import { config } from "./config";

// internal state
let rpc: Client;

// Zrzur's own Discord application ID (Discord Developer Portal → Applications).
// Empty = Discord Rich Presence stays off. Never reuse the upstream Stoat/Revolt ID.
const DISCORD_CLIENT_ID = "";

export async function initDiscordRpc() {
  if (!config.discordRpc || !DISCORD_CLIENT_ID) return;

  // clean up existing client if one exists
  rpc?.removeAllListeners();

  try {
    rpc = new Client({ transport: "ipc" });

    rpc.on("ready", () =>
      rpc.setActivity({
        state: "zrzur.com",
        details: "Chatting with others",
        largeImageKey: "qr",
        largeImageText: "Join Zrzur!",
        buttons: [
          {
            label: "Join Zrzur",
            url: "https://zrzur.com/",
          },
        ],
      }),
    );

    rpc.on("disconnected", reconnect);

    rpc.login({ clientId: DISCORD_CLIENT_ID });
  } catch (err) {
    reconnect();
  }
}

const reconnect = () => setTimeout(() => initDiscordRpc(), 1e4);

export async function destroyDiscordRpc() {
  rpc?.destroy();
}
