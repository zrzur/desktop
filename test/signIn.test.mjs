import assert from "node:assert/strict";
import test from "node:test";

import {
  isSignInPage,
  isSignInStart,
  signInReturn,
} from "../src/native/signInRules.ts";

const APP = "https://app.zrzur.com";

test("each service's sign-in page opens the sign-in window", () => {
  for (const address of [
    "https://steamcommunity.com/openid/login?openid.mode=checkid_setup",
    "https://id.twitch.tv/oauth2/authorize?client_id=x&state=y",
    "https://github.com/login/oauth/authorize?client_id=x",
    "https://oauth.battle.net/authorize?client_id=x",
  ]) {
    assert.equal(isSignInStart(address), true, address);
  }
});

test("any other address stays blocked", () => {
  for (const address of [
    "https://github.com/zrzur",
    "http://github.com/login/oauth/authorize",
    "https://github.com.evil.example/login/oauth/authorize",
    "https://user:pass@github.com/login/oauth/authorize",
    "https://github.com:8443/login/oauth/authorize",
    "https://evil.example/openid/login",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(isSignInStart(address), false, address);
  }
});

test("only Zrzur's own return page goes back to the main window", () => {
  assert.equal(
    signInReturn(
      `${APP}/connections/steam/return?state=abc&openid.mode=id_res`,
      APP,
    ),
    `${APP}/connections/steam/return?state=abc&openid.mode=id_res`,
  );
  assert.equal(
    signInReturn(`${APP}/connections/battlenet/return?code=1&state=2`, APP),
    `${APP}/connections/battlenet/return?code=1&state=2`,
  );
  for (const address of [
    `${APP}/settings`,
    `${APP}/connections/steam/return/../../logout`,
    "https://evil.example/connections/steam/return",
    "https://beta.zrzur.com/connections/steam/return",
  ]) {
    assert.equal(signInReturn(address, APP), undefined, address);
  }
});

test("the sign-in window stays on the services' sign-in hosts", () => {
  for (const address of [
    "https://steamcommunity.com/login/home",
    "https://login.steampowered.com/jwt/finalizelogin",
    "https://www.twitch.tv/login",
    "https://github.com/sessions/two-factor",
    "https://account.battle.net/login",
    "https://eu.battle.net/login/en/",
  ]) {
    assert.equal(isSignInPage(address), true, address);
  }
  for (const address of [
    "https://evil.example/",
    "https://battle.net.evil.example/",
    "https://evilbattle.net/",
    "http://github.com/login",
    "https://github.com:444/login",
    "https://app.zrzur.com/settings",
  ]) {
    assert.equal(isSignInPage(address), false, address);
  }
});
