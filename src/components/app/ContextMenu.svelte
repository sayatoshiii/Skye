<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import MessageMenu, { type MenuItem } from "./MessageMenu.svelte";

  type Field = HTMLInputElement | HTMLTextAreaElement;

  const TEXT_TYPES = ["text", "search", "url", "tel", "email", "password", "number"];
  const EDITABLE = "input, textarea, [contenteditable]:not([contenteditable='false'])";

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let menu: { items: MenuItem[]; x: number; y: number } | null = $state.raw(null);
  let pasteDenied = false;

  $effect(() => {
    navigator.permissions
      ?.query({ name: "clipboard-read" as PermissionName })
      .then((status) => {
        pasteDenied = status.state === "denied";
        status.onchange = () => (pasteDenied = status.state === "denied");
      })
      .catch(() => undefined);
  });

  const canPaste = () => !!navigator.clipboard?.readText && !pasteDenied;

  const isField = (element: Element): element is Field =>
    element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && TEXT_TYPES.includes(element.type));

  const restore = (element: HTMLElement, range: Range | { start: number; end: number } | null) => {
    element.focus({ preventScroll: true });
    if (!range) return;
    if (range instanceof Range) {
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else (element as Field).setSelectionRange(range.start, range.end);
  };

  const paste = async (element: HTMLElement, range: Range | { start: number; end: number } | null) => {
    try {
      const value = await navigator.clipboard.readText();
      restore(element, range);
      document.execCommand("insertText", false, value);
    } catch {
      pasteDenied = true;
      restore(element, range);
    }
  };

  const editItems = (element: HTMLElement): MenuItem[] => {
    const field = isField(element) ? element : null;
    const locked = field ? field.readOnly || field.disabled : false;
    const secret = field?.type === "password";
    const range = field
      ? { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 }
      : (getSelection()?.rangeCount ? getSelection()!.getRangeAt(0).cloneRange() : null);
    const selected = field ? (range as { start: number; end: number }).end > (range as { start: number; end: number }).start : !!getSelection()?.toString();
    const empty = field ? !field.value : !element.textContent;

    const run = (command: string) => () => {
      restore(element, range);
      document.execCommand(command);
    };

    const items: MenuItem[] = [
      { id: "cut", label: text("context_menu", "cut"), icon: MENU_ICONS.cut, disabled: !selected || locked || secret, run: run("cut") },
      { id: "copy", label: text("context_menu", "copy"), icon: MENU_ICONS.copy, disabled: !selected || secret, run: run("copy") },
    ];
    if (canPaste()) items.push({ id: "paste", label: text("context_menu", "paste"), icon: MENU_ICONS.paste, disabled: locked, run: () => paste(element, range) });
    items.push({
      id: "select_all",
      label: text("context_menu", "select_all"),
      icon: MENU_ICONS.select,
      disabled: empty,
      run: () => {
        element.focus({ preventScroll: true });
        document.execCommand("selectAll");
      },
    });
    return items;
  };

  const pageItems = (target: Element): MenuItem[] => {
    const items: MenuItem[] = [];
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    const selected = getSelection()?.toString() ?? "";

    if (anchor) {
      items.push(
        { id: "open_link", label: text("context_menu", "open_link"), icon: MENU_ICONS.open, run: () => void window.open(anchor.href, "_blank", "noopener,noreferrer") },
        { id: "copy_link", label: text("context_menu", "copy_link"), icon: MENU_ICONS.link, run: () => void navigator.clipboard?.writeText(anchor.href).catch(() => undefined) },
      );
    }

    if (selected) {
      items.push(
        { id: "copy", label: text("context_menu", "copy"), icon: MENU_ICONS.copy, run: () => void navigator.clipboard?.writeText(selected).catch(() => undefined) },
        {
          id: "select_all",
          label: text("context_menu", "select_all"),
          icon: MENU_ICONS.select,
          run: () => {
            const scope = target.closest(".selectable") ?? document.body;
            const range = document.createRange();
            range.selectNodeContents(scope);
            getSelection()?.removeAllRanges();
            getSelection()?.addRange(range);
          },
        },
      );
    }

    return items;
  };

  const oncontextmenu = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    const editable = target?.closest<HTMLElement>(EDITABLE);
    const touch = (event as PointerEvent).pointerType === "touch";
    if (touch && editable) return;
    event.preventDefault();
    if (touch || !target) return;

    const items = editable && (isField(editable) || editable.isContentEditable) ? editItems(editable) : pageItems(target);
    menu = items.length ? { items, x: event.clientX, y: event.clientY } : null;
  };

  $effect(() => {
    document.addEventListener("contextmenu", oncontextmenu);
    return () => document.removeEventListener("contextmenu", oncontextmenu);
  });
</script>

{#if menu}
  {#key menu}
    <MessageMenu items={menu.items} x={menu.x} y={menu.y} label={text("context_menu", "actions")} onclose={() => (menu = null)} />
  {/key}
{/if}
