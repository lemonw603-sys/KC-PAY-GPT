import { parseSessionInput, SUPPORTED_SESSION_COOKIE_NAMES } from "./token.mjs";
import { isSessionCookieName, sessionCookieRemovals, splitSessionCookie } from "./cookie-chunks.mjs";

const CHATGPT_URL = "https://chatgpt.com/";

const loginForm = document.querySelector("#loginForm");
const tokenInput = document.querySelector("#sessionToken");
const cookieType = document.querySelector("#cookieType");
const toggleToken = document.querySelector("#toggleToken");
const loginButton = document.querySelector("#loginButton");
const statusMessage = document.querySelector("#statusMessage");
const sessionBadge = document.querySelector("#sessionBadge");

function setStatus(message, tone) {
  statusMessage.textContent = message;
  statusMessage.dataset.tone = tone;
  statusMessage.hidden = false;
}

function setBusy(isBusy) {
  loginButton.disabled = isBusy;
  loginButton.querySelector("span").textContent = isBusy
    ? "正在写入安全会话…"
    : "写入会话并打开 ChatGPT";
}

async function refreshSessionBadge() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: "chatgpt.com" });
    const hasSession = cookies.some((cookie) => isSessionCookieName(cookie.name, SUPPORTED_SESSION_COOKIE_NAMES));

    sessionBadge.textContent = hasSession ? "已有会话" : "未登录";
    sessionBadge.dataset.active = String(hasSession);
  } catch {
    sessionBadge.textContent = "状态未知";
  }
}

async function writeSessionCookie(name, value) {
  const cookieDetails = {
    url: CHATGPT_URL,
    name,
    value,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax"
  };

  if (!name.startsWith("__Host-")) {
    cookieDetails.domain = ".chatgpt.com";
  }

  const savedCookie = await chrome.cookies.set(cookieDetails);

  if (!savedCookie || savedCookie.value !== value) {
    throw new Error("浏览器未能保存会话 Cookie。");
  }
}

// Manual tool: pressing "write" means "log this Profile in as this account".
// Any session already there (the previous customer's, or one ChatGPT rotated)
// is removed first, otherwise the browser keeps sending the old identity.
async function closeChatGptTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://*.chatgpt.com/*"] });
  if (tabs.length > 0) await chrome.tabs.remove(tabs.map((tab) => tab.id));
  return tabs.length;
}

async function removeExistingSessionCookies() {
  const existing = await chrome.cookies.getAll({ domain: "chatgpt.com" });
  const removals = sessionCookieRemovals(existing, SUPPORTED_SESSION_COOKIE_NAMES);
  for (const target of removals) await chrome.cookies.remove(target);
  const leftover = (await chrome.cookies.getAll({ domain: "chatgpt.com" }))
    .filter((cookie) => isSessionCookieName(cookie.name, SUPPORTED_SESSION_COOKIE_NAMES));
  if (leftover.length > 0) throw new Error("旧会话 Cookie 未能清除，请关闭 ChatGPT 标签页后重试。");
  return removals.length;
}

async function writeSessionCookies(name, value) {
  const closedTabs = await closeChatGptTabs();
  const replacedCount = await removeExistingSessionCookies();
  const chunks = splitSessionCookie(name, value);
  for (const chunk of chunks) await writeSessionCookie(chunk.name, chunk.value);
  return { chunkCount: chunks.length, replacedCount, closedTabs };
}

toggleToken.addEventListener("click", () => {
  const isVisible = toggleToken.getAttribute("aria-pressed") === "true";
  toggleToken.setAttribute("aria-pressed", String(!isVisible));
  toggleToken.setAttribute("aria-label", isVisible ? "显示令牌" : "隐藏令牌");
  tokenInput.dataset.masked = String(isVisible);
  tokenInput.focus();
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusMessage.hidden = true;

  try {
    const { name, value } = parseSessionInput(tokenInput.value, cookieType.value);
    setBusy(true);
    const written = await writeSessionCookies(name, value);

    tokenInput.value = "";
    setStatus(written.replacedCount > 0
      ? `已替换原会话（清除 ${written.replacedCount} 条旧 Cookie），正在打开 ChatGPT。`
      : "会话已写入，正在打开 ChatGPT。", "success");
    await refreshSessionBadge();
    await chrome.tabs.create({ url: CHATGPT_URL });
    window.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : "写入失败，请重试。";
    setStatus(message, "error");
    tokenInput.focus();
  } finally {
    setBusy(false);
  }
});

refreshSessionBadge();
tokenInput.dataset.masked = "true";
tokenInput.focus();
