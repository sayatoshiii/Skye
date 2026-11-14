<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import { lift, reveal } from "../../../components/auth/motion";
  import MorphText from "../../../components/ui/MorphText.svelte";
  import { isMatrixError } from "../../../scripts/api/client";
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import {
    getAuthMethods,
    getLoginFlows,
    getLoginTokenFromURL,
    getSSORedirectURL,
    loginWithPassword,
    loginWithToken,
    registerAccount,
    type AuthMethod,
  } from "../../../scripts/matrix/auth";
  import {
    resolveHomeserver,
    serverNameFromUserId,
  } from "../../../scripts/matrix/discovery";
  import type { IdentityProvider, LoginFlow } from "../../../scripts/matrix/types";
  import {
    DEFAULT_HOMESERVER,
    PENDING_SSO_HOMESERVER_KEY,
    ROUTES,
  } from "../../../scripts/settings/config";

  type Step = "homeserver" | "credentials" | "oidc" | "sso" | "unsupported";
  type Mode = "signin" | "register";
  type Unsupported = { stages: string[]; fallbackURL?: string; session?: string };
  type Status = "idle" | "resolving" | "ok" | "error";
  type Server = {
    name: string;
    homeserver: string;
    methods: AuthMethod[];
    providers: IdentityProvider[];
    oidcOnly: boolean;
  };

  const DEBOUNCE = 450;

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  const format = (template: string, values: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));

  let step = $state<Step>("homeserver");
  let serverInput = $state(DEFAULT_HOMESERVER);
  let status = $state<Status>("idle");
  let statusMessage = $state("");
  let server = $state<Server | null>(null);
  let username = $state("");
  let password = $state("");
  let error = $state("");
  let busy = $state(false);
  let usernameField: HTMLInputElement | undefined = $state();
  let mode = $state<Mode>("signin");
  let confirmPassword = $state("");
  let token = $state("");
  let needsToken = $state(false);
  let unsupported = $state<Unsupported | null>(null);
  let pendingSession: string | undefined;
  let tokenField: HTMLInputElement | undefined = $state();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lookup = 0;

  const friendlyError = (reason: unknown) => {
    if (isMatrixError(reason)) {
      if (reason.errcode === "M_FORBIDDEN") return text("login", "errors", "forbidden");
      if (reason.errcode === "M_USER_DEACTIVATED")
        return text("login", "errors", "deactivated");
      if (reason.errcode === "M_LIMIT_EXCEEDED")
        return reason.retryAfterMs
          ? format(text("login", "errors", "rate_limited"), {
              seconds: Math.ceil(reason.retryAfterMs / 1000),
            })
          : text("login", "errors", "rate_limited_generic");
      return reason.body.error ?? text("login", "errors", "unknown");
    }
    if (reason instanceof TypeError) return text("login", "errors", "network");
    return text("login", "errors", "unknown");
  };

  const discover = async (input: string): Promise<Server> => {
    const resolved = await resolveHomeserver(input);
    const flows: LoginFlow[] = await getLoginFlows(resolved.homeserver);
    const methods = getAuthMethods(flows);
    const providers = flows.flatMap((flow) =>
      flow.type === "m.login.sso"
        ? ((flow.identity_providers as IdentityProvider[] | undefined) ?? [])
        : [],
    );

    return {
      name: input.trim().replace(/^https?:\/\//, "").replace(/\/+$/, ""),
      homeserver: resolved.homeserver,
      methods,
      providers,
      oidcOnly: !methods.includes("password") && !methods.includes("sso"),
    };
  };

  const resolve = async (input: string) => {
    const id = ++lookup;

    if (!input.trim()) {
      status = "error";
      statusMessage = text("login", "errors", "empty_homeserver");
      server = null;
      return null;
    }

    status = "resolving";
    statusMessage = text("login", "resolving");

    try {
      const found = await discover(input);
      if (id !== lookup) return null;
      server = found;
      status = "ok";
      statusMessage = format(text("login", "resolved"), { server: found.name });
      return found;
    } catch (reason) {
      if (id !== lookup) return null;
      server = null;
      status = "error";
      statusMessage = isMatrixError(reason)
        ? text("login", "errors", "not_matrix")
        : text("login", "errors", "unreachable");
      return null;
    }
  };

  const scheduleResolve = () => {
    clearTimeout(timer);
    server = null;
    status = serverInput.trim() ? "resolving" : "idle";
    statusMessage = serverInput.trim() ? text("login", "resolving") : "";
    timer = setTimeout(() => resolve(serverInput), DEBOUNCE);
  };

  const enterCredentials = async (found: Server) => {
    error = "";
    if (found.oidcOnly) {
      step = "oidc";
      return;
    }
    if (!found.methods.includes("password") && !found.methods.includes("sso")) {
      status = "error";
      statusMessage = text("login", "no_methods");
      return;
    }
    step = "credentials";
    await tick();
    usernameField?.focus();
  };

  const continueToCredentials = async () => {
    clearTimeout(timer);
    const found = status === "ok" && server ? server : await resolve(serverInput);
    if (found) await enterCredentials(found);
  };

  const onUsernameInput = () => {
    const match = username.trim().match(/^@[^:\s]+:([^\s]+)$/);
    if (!match) return;
    const serverName = serverNameFromUserId(username.trim());
    if (serverName === serverInput.trim() || !match[1]) return;
    serverInput = serverName;
    scheduleResolve();
  };

  const submit = async () => {
    if (busy) return;
    error = "";

    if (!username.trim() || !password) {
      error = text("login", "errors", "empty_fields");
      return;
    }

    busy = true;

    try {
      clearTimeout(timer);
      const target = status === "ok" && server ? server : await resolve(serverInput);
      if (!target) {
        error = statusMessage || text("login", "errors", "unreachable");
        return;
      }
      await loginWithPassword(target.homeserver, username.trim(), password);
      location.replace(ROUTES.app);
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      busy = false;
    }
  };

  const startSSO = (provider?: IdentityProvider) => {
    if (!server) return;
    try {
      sessionStorage.setItem(PENDING_SSO_HOMESERVER_KEY, server.homeserver);
    } catch {}
    location.assign(
      getSSORedirectURL(server.homeserver, location.origin + ROUTES.login, provider?.id),
    );
  };

  const completeSSO = async (token: string) => {
    step = "sso";
    let homeserver: string | null = null;
    try {
      homeserver = sessionStorage.getItem(PENDING_SSO_HOMESERVER_KEY);
      sessionStorage.removeItem(PENDING_SSO_HOMESERVER_KEY);
    } catch {}

    history.replaceState(null, "", ROUTES.login);

    try {
      const target = homeserver ?? (await resolveHomeserver(DEFAULT_HOMESERVER)).homeserver;
      await loginWithToken(target, token);
      location.replace(ROUTES.app);
    } catch (reason) {
      step = "homeserver";
      status = "error";
      statusMessage = isMatrixError(reason)
        ? text("login", "errors", "sso_failed")
        : friendlyError(reason);
    }
  };

  const back = () => {
    error = "";
    password = "";
    step = "homeserver";
  };

  const onHomeserverKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    continueToCredentials();
  };

  onMount(() => {
    const token = getLoginTokenFromURL();
    if (token) completeSSO(token);
    else resolve(serverInput);
    return () => clearTimeout(timer);
  });

  const registerError = (reason: unknown) => {
    if (isMatrixError(reason)) {
      if (reason.errcode === "M_FORBIDDEN") return text("login", "errors", "registration_closed");
      if (reason.errcode === "M_USER_IN_USE") return text("login", "errors", "user_in_use");
      if (reason.errcode === "M_INVALID_USERNAME") return text("login", "errors", "invalid_username");
      if (reason.errcode === "M_EXCLUSIVE") return text("login", "errors", "exclusive");
      if (reason.errcode === "M_WEAK_PASSWORD") return text("login", "errors", "weak_password");
      if (reason.errcode === "M_UNAUTHORIZED" && needsToken)
        return text("login", "errors", "invalid_token");
    }
    return friendlyError(reason);
  };

  const register = async () => {
    if (busy) return;
    error = "";

    if (!username.trim() || !password) {
      error = text("login", "errors", "empty_fields");
      return;
    }
    if (password !== confirmPassword) {
      error = text("login", "errors", "password_mismatch");
      return;
    }
    if (needsToken && !token.trim()) {
      error = text("login", "errors", "empty_token");
      tokenField?.focus();
      return;
    }

    busy = true;

    try {
      clearTimeout(timer);
      const target = status === "ok" && server ? server : await resolve(serverInput);
      if (!target) {
        error = statusMessage || text("login", "errors", "unreachable");
        return;
      }
      const session = pendingSession;
      pendingSession = undefined;
      const result = await registerAccount(
        target.homeserver,
        username.trim().replace(/^@/, "").split(":")[0],
        password,
        { token: token.trim() || undefined, session },
      );
      if (result.kind === "registered") {
        location.replace(ROUTES.app);
        return;
      }
      if (result.kind === "needs_token") {
        needsToken = true;
        await tick();
        tokenField?.focus();
        return;
      }
      unsupported = result;
      step = "unsupported";
    } catch (reason) {
      error = registerError(reason);
    } finally {
      busy = false;
    }
  };

  const retryRegistration = () => {
    pendingSession = unsupported?.session;
    step = "credentials";
    register();
  };

  const setMode = (next: Mode) => {
    error = "";
    needsToken = false;
    unsupported = null;
    confirmPassword = "";
    mode = next;
  };

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (step === "homeserver") continueToCredentials();
    else if (mode === "register") register();
    else submit();
  };

  const stageList = (stages: string[]) => {
    const names = [
      ...new Set(
        stages.map(
          (stage) =>
            (getLocalisedText(undefined, "login", "stages", stage) as string | undefined) ??
            text("login", "stages", "unknown"),
        ),
      ),
    ];
    if (names.length < 2) return names[0] ?? text("login", "stages", "unknown");
    return `${names.slice(0, -1).join(", ")} ${text("login", "and")} ${names.at(-1)}`;
  };

  const stage = $derived(
    step === "credentials" || step === "homeserver" ? `${mode}_${step}` : step,
  );
  const heading = $derived(text("login", "headings", stage));
  const subtitle = $derived(
    step === "oidc"
      ? text("login", "oidc_body")
      : step === "unsupported" && server && unsupported
        ? format(
            text("login", unsupported.fallbackURL ? "unsupported_body" : "unsupported_none"),
            { server: server.name, stages: stageList(unsupported.stages) },
          )
        : text("login", "subtitles", stage),
  );
  const showPassword = $derived(
    step === "credentials" &&
      !!server &&
      (mode === "register" || server.methods.includes("password")),
  );
  const showSSO = $derived(
    step === "credentials" && mode === "signin" && !!server?.methods.includes("sso"),
  );
  const showPrimary = $derived(step === "homeserver" || showPassword);
  const primaryLabel = $derived(
    step === "homeserver"
      ? text("login", "continue")
      : mode === "register"
        ? busy
          ? text("login", "creating")
          : text("login", "create")
        : busy
          ? text("login", "signing_in")
          : text("login", "submit"),
  );
</script>


<main class="login row centre">
  <div class="shell">
    <section class="pane col" aria-labelledby="login-heading">
      <header class="top row-nw align-centre justify-between">
        <span class="wordmark">{text("login", "wordmark")}</span>
      </header>

      <div class="body col">
        <MorphText tag="h1" id="login-heading" class="heading" text={heading} />
        <div class="subtitle stack">
          {#key subtitle}
            <p class="muted" in:lift={{ direction: 1, blur: 0 }} out:fade={{ duration: 120 }}>{subtitle}</p>
          {/key}
        </div>

        <form class="form col" onsubmit={onSubmit} novalidate aria-busy={busy}>
          {#if step === "homeserver"}
            <div class="slot" transition:reveal>
              <label class="field col gap-sm">
                <span class="label">{text("login", "homeserver")}</span>
                <input
                  class="input"
                  type="text"
                  inputmode="url"
                  autocomplete="url"
                  autocapitalize="off"
                  spellcheck="false"
                  aria-describedby="login-status"
                  bind:value={serverInput}
                  oninput={scheduleResolve}
                  onkeydown={onHomeserverKey}
                />
              </label>
              <p id="login-status" class="status row-nw align-centre gap-sm" data-status={status} aria-live="polite">
                <span class="dot" aria-hidden="true"></span>
                <span>{statusMessage || text("login", "homeserver_hint")}</span>
              </p>
            </div>
          {/if}

          {#if step === "credentials" && server}
            <div class="slot" transition:reveal>
              <div class="chip row-nw align-centre justify-between gap-sm">
                <span class="truncate">
                  <span class="faint">{text("login", "server_label")}</span>
                  <span class="strong">{server.name}</span>
                </span>
                <button class="link ghost press" type="button" onclick={back}>
                  {text("login", "change")}
                </button>
              </div>
            </div>
          {/if}

          {#if showPassword}
            <div class="slot" transition:reveal>
              <label class="field col gap-sm">
                <span class="label">{text("login", "username")}</span>
                <input
                  class="input"
                  type="text"
                  autocomplete="username"
                  autocapitalize="off"
                  spellcheck="false"
                  placeholder={text("login", "username_hint")}
                  bind:this={usernameField}
                  bind:value={username}
                  oninput={onUsernameInput}
                />
              </label>
            </div>
            <div class="slot" transition:reveal>
              <label class="field col gap-sm">
                <span class="label">{text("login", "password")}</span>
                <input
                  class="input"
                  type="password"
                  autocomplete={mode === "register" ? "new-password" : "current-password"}
                  bind:value={password}
                />
              </label>
            </div>
          {/if}

          {#if showPassword && mode === "register"}
            <div class="slot" transition:reveal>
              <label class="field col gap-sm">
                <span class="label">{text("login", "confirm_password")}</span>
                <input class="input" type="password" autocomplete="new-password" bind:value={confirmPassword} />
              </label>
            </div>
          {/if}

          {#if showPassword && mode === "register" && needsToken}
            <div class="slot" transition:reveal>
              <label class="field col gap-sm">
                <span class="label">{text("login", "token")}</span>
                <input
                  class="input"
                  type="text"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  aria-describedby="login-token-hint"
                  bind:this={tokenField}
                  bind:value={token}
                />
                <span id="login-token-hint" class="hint faint">{text("login", "token_hint")}</span>
              </label>
            </div>
          {/if}

          {#if error}
            <div class="slot" transition:reveal>
              <p class="error" role="alert">{error}</p>
            </div>
          {/if}

          {#if showPrimary}
            <div class="slot" transition:reveal>
              <button
                class="primary press"
                type="submit"
                disabled={busy || (step === "homeserver" && status === "resolving")}
                aria-busy={busy}
              >
                <span class="stack">
                  {#key primaryLabel}
                    <span in:lift={{ direction: 1, blur: 4 }} out:lift={{ direction: -1, blur: 4 }}>{primaryLabel}</span>
                  {/key}
                </span>
              </button>
            </div>
          {/if}

          {#if showSSO && server}
            {#if server.methods.includes("password")}
              <div class="slot" transition:reveal|global>
                <div class="divider row-nw align-centre gap-md faint">
                  <span></span>{text("login", "or")}<span></span>
                </div>
              </div>
            {/if}
            <div class="slot" transition:reveal>
              <div class="col gap-sm">
                {#if server.providers.length}
                  {#each server.providers as provider (provider.id)}
                    <button class="secondary press" type="button" onclick={() => startSSO(provider)}>
                      {format(text("login", "sso"), { provider: provider.name })}
                    </button>
                  {/each}
                {:else}
                  <button class="secondary press" type="button" onclick={() => startSSO()}>
                    {text("login", "sso_generic")}
                  </button>
                {/if}
              </div>
            </div>
          {/if}

          {#if step === "oidc" && server}
            <div class="slot" transition:reveal>
              <button class="secondary press" type="button" onclick={back}>
                {text("login", "change")}
              </button>
            </div>
          {/if}

          {#if step === "unsupported" && unsupported}
            <div class="slot" transition:reveal>
              <div class="col gap-sm">
                {#if unsupported.fallbackURL}
                  <a class="primary press" href={unsupported.fallbackURL} target="_blank" rel="noopener noreferrer">
                    {text("login", "open_signup")}
                  </a>
                  <button class="secondary press" type="button" disabled={busy} onclick={retryRegistration}>
                    {text("login", "retry")}
                  </button>
                {/if}
                <button class="secondary press" type="button" onclick={() => (step = "credentials")}>
                  {text("navigation", "back")}
                </button>
              </div>
            </div>
          {/if}

          {#if step === "sso"}
            <div class="slot" transition:reveal>
              <p class="status row-nw align-centre gap-sm" data-status="resolving" aria-live="polite">
                <span class="dot" aria-hidden="true"></span>
                <span>{text("login", "completing_sso")}</span>
              </p>
            </div>
          {/if}
        </form>
      </div>

      {#if step === "homeserver" || step === "credentials"}
        <footer class="footer row-nw centre gap-sm" transition:fade={{ duration: 160 }}>
          <MorphText class="muted" text={mode === "signin" ? text("login", "to_register") : text("login", "to_signin")} />
          <button
            class="link ghost press"
            type="button"
            onclick={() => setMode(mode === "signin" ? "register" : "signin")}
          >
            <MorphText text={mode === "signin" ? text("login", "to_register_action") : text("login", "to_signin_action")} />
          </button>
        </footer>
      {/if}
    </section>
  </div>
</main>

<style>
  .login {
    position: relative;
    z-index: 1;
    width: 100%;
    min-height: 100vh;
    min-height: 100dvh;
    padding: max(var(--azure-spacing-xl), env(safe-area-inset-top))
      max(var(--azure-spacing-xl), env(safe-area-inset-right))
      max(var(--azure-spacing-xl), env(safe-area-inset-bottom))
      max(var(--azure-spacing-xl), env(safe-area-inset-left));
  }

  .shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
    max-width: 520px;
    min-height: min(680px, calc(100dvh - 4 * var(--azure-spacing-xl)));
  }


  .pane {
    min-width: 0;
    padding: var(--azure-spacing-xl) calc(var(--azure-spacing-xl) * 1.5);
  }

  .top {
    min-height: 32px;
  }

  @media (min-width: 768px) {
    .top {
      position: fixed;
      top: max(var(--azure-spacing-xl), env(safe-area-inset-top));
      left: max(calc(var(--azure-spacing-xl) * 1.5), env(safe-area-inset-left));
    }
  }

  .wordmark {
    font-size: var(--text-lg);
    font-weight: 800;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--colours-text-strong);
  }

  .body {
    flex: 1;
    justify-content: center;
    width: 100%;
    max-width: 380px;
    margin: 0 auto;
    padding: calc(var(--azure-spacing-xl) * 2) 0;
  }

  .body :global(.heading) {
    margin: 0;
    font-size: clamp(28px, 3.4vw, 38px);
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.02em;
    color: var(--colours-text-strong);
  }

  .stack {
    display: inline-grid;
  }

  .stack > :global(*) {
    grid-area: 1 / 1;
  }

  .subtitle {
    display: grid;
    margin-top: var(--azure-spacing-md);
    font-size: var(--text-md);
    line-height: 1.5;
  }

  .subtitle p {
    margin: 0;
  }

  .form {
    margin-top: var(--azure-spacing-lg);
  }

  .slot {
    padding-top: var(--azure-spacing-md);
  }

  .label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--colours-text-muted);
  }

  .field .input {
    width: 100%;
    min-height: var(--azure-touch);
    padding: 0 var(--azure-spacing-lg);
    box-sizing: border-box;
    transition:
      border-color var(--azure-duration-fast) var(--azure-ease-out),
      box-shadow var(--azure-duration-md) var(--azure-ease-out);
  }

  .field .input:focus {
    box-shadow: 0 0 24px -8px var(--colours-accent-glow);
  }

  .field .input::placeholder {
    color: var(--colours-text-faint);
  }

  .hint {
    font-size: var(--text-sm);
  }

  .status {
    margin: var(--azure-spacing-sm) 0 0;
    font-size: var(--text-sm);
    color: var(--colours-text-muted);
  }

  .status .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--colours-text-faint);
  }

  .status[data-status="ok"] .dot {
    background-color: var(--colours-success);
  }

  .status[data-status="resolving"] .dot {
    background-color: var(--colours-warning);
  }

  .status[data-status="error"] {
    color: var(--colours-danger);
  }

  .status[data-status="error"] .dot {
    background-color: var(--colours-danger);
  }

  .chip {
    min-height: var(--azure-touch);
    padding: 0 var(--azure-spacing-sm) 0 var(--azure-spacing-lg);
    border-radius: var(--azure-radius-pill);
    background-color: var(--colours-surface);
    border: 1px solid var(--colours-outline-hairline);
    font-size: var(--text-md);
  }

  .strong {
    color: var(--colours-text-strong);
    font-weight: 600;
  }

  .link {
    min-height: 32px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-pill);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--colours-accent-strong);
  }

  .link:hover {
    background-color: var(--colours-accent-faint);
    color: var(--colours-accent);
  }

  .error {
    margin: 0;
    padding: var(--azure-spacing-md) var(--azure-spacing-lg);
    border-radius: var(--azure-radius-md);
    background-color: var(--colours-danger-soft);
    color: var(--colours-danger);
    font-size: var(--text-sm);
  }

  .primary,
  .secondary {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    min-height: calc(var(--azure-touch) + 4px);
    padding: 0 var(--azure-spacing-xl);
    box-sizing: border-box;
    border-radius: var(--azure-radius-pill);
    font: inherit;
    font-size: var(--text-md);
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
  }

  .primary {
    border: 1px solid color-mix(in oklab, var(--colours-accent) 28%, transparent);
    color: var(--colours-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 10%, transparent);
    transition:
      background-color var(--azure-duration-fast) var(--azure-ease-out),
      border-color var(--azure-duration-fast) var(--azure-ease-out),
      color var(--azure-duration-fast) var(--azure-ease-out),
      transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .primary:hover {
    color: var(--colours-text-strong);
    border-color: color-mix(in oklab, var(--colours-accent) 45%, transparent);
    background-color: color-mix(in oklab, var(--colours-accent) 18%, transparent);
  }

  .primary:disabled {
    cursor: progress;
    opacity: 0.7;
  }

  .primary:focus-visible,
  .secondary:focus-visible {
    outline-offset: 2px;
  }

  .secondary {
    color: var(--colours-text);
    background-color: transparent;
    border: 1px solid var(--colours-outline-hairline);
  }

  .secondary:hover {
    color: var(--colours-text-strong);
    border-color: var(--colours-outline-light);
    background-color: var(--colours-surface-hover);
  }

  .divider {
    font-size: var(--text-sm);
  }

  .divider span {
    flex: 1;
    height: 1px;
    background-color: var(--colours-outline-hairline);
  }

  .footer {
    flex-wrap: wrap;
    font-size: var(--text-sm);
  }

  @media (max-width: 767px) {
    .login {
      align-items: stretch;
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
        env(safe-area-inset-left);
    }

    .shell {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto 1fr;
      gap: 0;
      min-height: 100dvh;
      padding: var(--azure-spacing-md);
    }


    .pane {
      padding: var(--azure-spacing-xl) var(--azure-spacing-md) var(--azure-spacing-md);
    }

    .top {
      order: -1;
    }

    .body {
      justify-content: flex-start;
      max-width: none;
      padding: calc(var(--azure-spacing-xl) * 1.5) 0;
    }
  }

</style>
