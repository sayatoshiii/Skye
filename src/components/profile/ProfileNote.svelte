<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { notes, setNote } from "../../scripts/stores/notes";

  let { userId }: { userId: string } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;
  const id = `note-${Math.random().toString(36).slice(2)}`;

  let noteMap: Record<string, string> = $state.raw({});
  $effect(() => notes.subscribe((value) => (noteMap = value)));
</script>

<section class="col gap-sm">
  <label class="heading xs bold" for={id}>{text("user_profile", "note")}</label>
  <textarea
    {id}
    class="note"
    rows="2"
    maxlength="256"
    placeholder={text("user_profile", "note_hint")}
    value={noteMap[userId] ?? ""}
    oninput={(event) => setNote(userId, event.currentTarget.value)}
  ></textarea>
</section>

<style>
  section {
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: color-mix(in oklab, var(--colours-foreground) 85%, var(--colours-background));
  }

  .heading {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--colours-text-faint);
  }

  .note {
    width: 100%;
    box-sizing: border-box;
    padding: 0;
    margin: 0;
    resize: none;
    field-sizing: content;
    min-height: 1.4em;
    font: inherit;
    font-size: var(--text-md);
    line-height: 1.4;
    color: var(--colours-text-strong);
    background: none;
    border: 0;
    outline: none;
  }

  .note::placeholder {
    color: var(--colours-text-faint);
  }
</style>
