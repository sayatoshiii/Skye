<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { ownProfile } from "../../scripts/stores/matrix";
  import Avatar from "../ui/Avatar.svelte";

  const text = (...path: string[]) =>
    getLocalisedText(undefined, ...path) as string;

  const name = $derived($ownProfile?.displayName ?? $ownProfile?.userId ?? text("profile", "placeholder", "display_name"));
  const userId = $derived($ownProfile?.userId ?? text("profile", "placeholder", "user_id"));
</script>

<section class="profile row-nw gap-md align-centre min-0">
  <Avatar name={name} url={$ownProfile?.avatarUrl} size="40px" radius="50%" />
  <div class="col min-0">
    <p class="bold md truncate">{name}</p>
    <span class="sm muted truncate">{userId}</span>
  </div>
</section>

<style>
  .profile {
    flex: 1 1 auto;
  }

  p {
    margin: 0;
    color: var(--colours-text-strong);
  }
</style>
