<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { ROUTES } from "../../scripts/settings/config";
  import { signOut } from "../../scripts/stores/matrix";

  let busy = $state(false);

  const leave = async () => {
    if (busy) return;
    busy = true;
    await signOut();
    location.replace(ROUTES.login);
  };
</script>

<button
  class="sign-out ghost press"
  aria-label={getLocalisedText(undefined, "profile", "sign_out")}
  title={getLocalisedText(undefined, "profile", "sign_out")}
  disabled={busy}
  onclick={leave}
>
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
</button>

<style>
  .sign-out {
    width: 36px;
    height: 36px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .sign-out:hover {
    color: var(--colours-danger);
    background-color: var(--colours-surface-hover);
  }

  .sign-out svg {
    transition: transform var(--azure-duration-md) var(--azure-ease-spring);
  }

  .sign-out:hover svg {
    transform: translateX(2px);
  }

  .sign-out:disabled {
    opacity: 0.5;
  }

  @media (max-width: 767px) {
    .sign-out {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }
  }
</style>
