<script lang="ts">
  import ColourPopover from "../ui/ColourPopover.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import Button from "../ui/Button.svelte";
  import { fromAction } from "svelte/attachments";
  import ImageInput from "../ui/ImageInput.svelte";
  import UnsavedBar from "../settings/UnsavedBar.svelte";
  import SettingsRow from "../settings/SettingsRow.svelte";
  import SettingsSection from "../settings/SettingsSection.svelte";
  import SettingsShell, { type ShellAction, type ShellGroup } from "../settings/SettingsShell.svelte";
  import { SETTINGS_ICONS } from "../settings/icons";
  import { ROOM_ICONS } from "../../scripts/misc/icons";
  import { ask, askLeave, prompt } from "../../scripts/menus/prompts.svelte";
  import { haze } from "../../scripts/misc/haze";
  import LoadingDots from "../ui/LoadingDots.svelte";
  import { openRoomSettings } from "../../scripts/stores/navigation.svelte";
  import { closureOf } from "../../scripts/menus/room";
  import { creatorsOf } from "../../scripts/matrix/rooms";
  import { announceSync, canOfferSync, childRooms, inSync, sourceOf, syncEnabled, syncingSpace, syncRoom, syncSpace, type RoleSource } from "../../scripts/matrix/utilities/rolesync";
  import Icon from "../settings/Icon.svelte";
  import { untrack } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { menu, openEntityMenu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { copied, toastKey } from "../../scripts/stores/toast";
  import { rooms, session } from "../../scripts/stores/matrix";
  import { getPowerLevel } from "../../scripts/matrix/rooms";
  import { uploadImage } from "../../scripts/matrix/utilities/account";
  import { sendState } from "../../scripts/matrix/utilities/state";
  import {
    DEFAULT_NAMES,
    PERMISSION_GROUPS,
    ROLES_EVENT,
    buildRoles,
    grant,
    permissionsFor,
    powerRead,
    readRoles,
    setPowerLevels,
    setRoles,
    type Permission,
    type Role,
    type RoleMeta,
  } from "../../scripts/matrix/utilities/power";
  import { hueOf } from "../../scripts/matrix/utilities/profile";
  import { profileTint } from "../../scripts/misc/palette.svelte";
  import type { PowerLevels, RoomSummary } from "../../scripts/matrix/types";
  import type { MenuItem } from "./MessageMenu.svelte";

  let colourAnchor: HTMLElement | null = $state(null);
  let { roomId, initial, onclose }: { roomId: string; initial?: string; onclose: () => void } = $props();

  type Tab = "display" | "permissions" | "members";
  type Section = "general" | "roles" | "access" | "advanced";
  type JoinRule = "invite" | "restricted" | "knock" | "public";
  type History = "shared" | "invited" | "joined" | "world_readable";

  const HISTORY: History[] = ["shared", "invited", "joined", "world_readable"];
  type Selection = number | "everyone";

  const TABS: Tab[] = ["display", "permissions", "members"];
  const PALETTE = [
    "#1abc9c", "#2ecc71", "#3498db", "#9b59b6", "#e91e63", "#f1c40f", "#e67e22", "#e74c3c", "#95a5a6", "#607d8b",
    "#11806a", "#1f8b4c", "#206694", "#71368a", "#ad1457", "#c27c0e", "#a84300", "#992d22", "#979c9f", "#546e7a",
  ];

  const text = (...path: string[]) => getLocalisedText(undefined, "room_settings", ...path) as string;
  const fill = (key: string, values: Record<string, string | number>) => Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), text(...key.split(".")));

  const curveX = (s: number) => 0.96 * (1 - s) ** 2 * s + s ** 3;
  const curveDX = (s: number) => 0.96 * (1 - s) * (1 - 3 * s) + 3 * s ** 2;
  const curveY = (s: number) => 2.16 * (1 - s) ** 2 * s + 3 * (1 - s) * s ** 2 + s ** 3;
  const ease = (t: number) => curveY(Array.from({ length: 8 }).reduce<number>((s) => Math.min(1, Math.max(0, s - (curveX(s) - t) / curveDX(s))), t));
  const grow = (_: Element) => ({ duration: 420, easing: ease, css: (t: number) => `grid-template-rows: ${t}fr; opacity: ${t};` });

  const room = $derived($rooms[roomId]);
  const me = $derived($session?.userId ?? "");
  const original = $derived(room?.powerLevels ?? {});
  const originalMeta = $derived(readRoles(room));
  const own = $derived(room ? getPowerLevel(room, me) : 0);
  const editable = $derived(own >= powerRead("m.room.power_levels")(original));
  const syncSource = $derived(room?.isSpace ? undefined : syncingSpace($rooms, room));
  const managed = $derived(!!syncSource);
  const metaEditable = $derived(own >= powerRead(ROLES_EVENT)(original) && !managed);
  const spaceSynced = $derived(syncEnabled(room));
  const spaceRooms = $derived(room?.isSpace ? childRooms($rooms, room) : []);
  const behind = $derived(spaceSynced && room ? spaceRooms.filter((child) => !inSync(sourceOf(room), child, me)).length : 0);
  const spaceRolesEditable = $derived(!!syncSource && getPowerLevel(syncSource, me) >= powerRead(ROLES_EVENT)(syncSource.powerLevels ?? {}));
  const openSpaceRoles = () => syncSource && openRoomSettings(syncSource.roomId, "roles");
  const roomBehind = $derived(!!syncSource && !!room && !inSync(sourceOf(syncSource), room, me));
  let syncing = $state(false);

  let draft: PowerLevels = $state(untrack(() => structuredClone(($rooms[roomId]?.powerLevels ?? {}) as PowerLevels)));
  let meta: RoleMeta[] = $state(untrack(() => structuredClone(readRoles($rooms[roomId]))));
  let editing = $state(false);
  const stateOf = (type: string) => $rooms[roomId]?.state[type]?.[""]?.content ?? {};
  let named = $state(untrack(() => $rooms[roomId]?.name ?? ""));
  let joinRule = $state<JoinRule>(untrack(() => (stateOf("m.room.join_rules").join_rule as JoinRule) ?? "invite"));
  let history = $state<History>(untrack(() => (stateOf("m.room.history_visibility").history_visibility as History) ?? "shared"));
  let encrypted = $state(untrack(() => !!$rooms[roomId]?.encryption));
  let pictureUrl = $state<string | null>(null);
  let unpictured = $state(false);
  let topic = $state(untrack(() => $rooms[roomId]?.topic ?? ""));
  let picture: { blob: Blob; file: File } | null = $state.raw(null);
  let pictureInput: { open: () => void; forget: () => void } | undefined = $state();
  let savedDetails = $state<string | null>(null);
  let selected = $state<Selection>("everyone");
  let tab = $state<Tab>("display");
  let query = $state("");
  let permQuery = $state("");
  let memberQuery = $state("");
  let pickQuery = $state("");
  let picking = $state(false);
  let picked = $state<string[]>([]);
  let deleting = $state<Role | null>(null);
  let busy = $state(false);
  let failed = $state(false);
  let demoting = $state(false);
  let uploading = $state(false);
  let levelError = $state(false);
  let picker: HTMLInputElement | undefined = $state();

  let section = $state<Section>(untrack(() => (["general", "roles", "access", "advanced"].includes(initial ?? "") ? (initial as Section) : "general")));
  let shell: { close: () => void } | undefined = $state();

  const base = $derived(draft.users_default ?? 0);
  const joined = $derived(Object.values(room?.members ?? {}).filter((member) => member.membership === "join").map((member) => member.userId));
  const roleName = (level: number) => (DEFAULT_NAMES[level] ? text(DEFAULT_NAMES[level]) : fill("level_name", { level }));
  const roles = $derived(buildRoles(draft, meta, joined, roleName));
  const needle = $derived(query.trim().toLowerCase());
  const shownRoles = $derived(roles.filter((role) => role.name.toLowerCase().includes(needle)));

  const everyone = $derived(selected === "everyone");
  const role = $derived(roles.find((entry) => entry.level === selected));
  const level = $derived(everyone ? base : (role?.level ?? base));
  const tabs = $derived<Tab[]>(everyone ? ["permissions"] : TABS);
  const activeTab = $derived<Tab>(tabs.includes(tab) ? tab : "permissions");
  const roleEditable = $derived(editable && level < own);
  const displayEditable = $derived(metaEditable && !everyone && level <= own);
  const colour = $derived(role?.color);
  const userLevel = (userId: string) => draft.users?.[userId] ?? base;
  const nameOf = (userId: string) => room?.members[userId]?.displayName ?? userId;
  const avatarOf = (userId: string) => room?.members[userId]?.avatarUrl;
  const free = $derived(Array.from({ length: Math.max(0, own - base - 1) }, (_, index) => base + 1 + index).find((value) => !roles.some((entry) => entry.level === value)));
  const canCreate = $derived(editable && metaEditable && free !== undefined);

  const permNeedle = $derived(permQuery.trim().toLowerCase());
  const available = $derived(permissionsFor(room));
  const permGroups = $derived(
    PERMISSION_GROUPS.map((group) => ({
      group,
      items: available.filter((permission) => permission.group === group && `${text("perm", permission.key, "label")} ${text("perm", permission.key, "hint")}`.toLowerCase().includes(permNeedle)),
    })),
  );
  const permOn = (permission: Permission) => permission.read(draft) <= level;
  const permAllowed = (permission: Permission) => roleEditable && permission.read(draft) <= own;

  const memberNeedle = $derived(memberQuery.trim().toLowerCase());
  const roleMembers = $derived((role?.members ?? []).filter((userId) => `${nameOf(userId)} ${userId}`.toLowerCase().includes(memberNeedle)));
  const memberAllowed = (userId: string) => !managed && editable && level <= own && (userId === me || userLevel(userId) < own);
  const pickNeedle = $derived(pickQuery.trim().toLowerCase());
  const candidates = $derived(joined.filter((userId) => userLevel(userId) !== level && userLevel(userId) < own && `${nameOf(userId)} ${userId}`.toLowerCase().includes(pickNeedle)));

  const canon = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(canon).join(",")}]`
      : value && typeof value === "object"
        ? `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canon((value as Record<string, unknown>)[key])}`).join(",")}}`
        : JSON.stringify(value);
  const snapshotMeta = (list: RoleMeta[]) => canon([...list].sort((a, b) => b.level - a.level));
  let savedPower = $state<string | null>(null);
  let savedMeta = $state<string | null>(null);
  $effect(() => void (canon(original), (savedPower = null)));
  $effect(() => void (snapshotMeta(originalMeta), (savedMeta = null)));
  const powerChanged = $derived(canon($state.snapshot(draft)) !== (savedPower ?? canon(original)));
  const metaChanged = $derived(snapshotMeta($state.snapshot(meta) as RoleMeta[]) !== (savedMeta ?? snapshotMeta(originalMeta)));
  let bar: { nudge: () => void } | undefined = $state();
  const nudge = () => bar?.nudge();
  const originalJoin = $derived((room?.state["m.room.join_rules"]?.[""]?.content?.join_rule as JoinRule) ?? "invite");
  const originalHistory = $derived((room?.state["m.room.history_visibility"]?.[""]?.content?.history_visibility as History) ?? "shared");
  const parents = $derived(room?.parents ?? []);
  const joinRules = $derived<JoinRule[]>(["invite", ...(parents.length ? (["restricted"] as const) : []), "knock", "public"]);
  const detailsOriginal = $derived(JSON.stringify([room?.name ?? "", room?.topic ?? "", originalJoin, originalHistory, !!room?.encryption]));
  $effect(() => void (detailsOriginal, (savedDetails = null)));
  const textChanged = $derived(JSON.stringify([named.trim(), topic.trim(), joinRule, history, encrypted]) !== (savedDetails ?? detailsOriginal));
  const detailsChanged = $derived(textChanged || !!picture || unpictured);
  const can = (type: string) => own >= powerRead(type)(original);
  const changed = $derived(powerChanged || metaChanged || detailsChanged);
  const ownNext = $derived(room && creatorsOf(room).includes(me) ? own : (draft.users?.[me] ?? base));

  const open = (next: Selection, nextTab: Tab = "display") => ((selected = next), (tab = nextTab), (editing = true), (levelError = false), (memberQuery = ""), (permQuery = ""));
  const back = () => (editing = false);

  const metaFor = (value: number) => meta.find((entry) => entry.level === value);
  const setMeta = (value: number, patch: Partial<RoleMeta>) =>
    (meta = [...meta.filter((entry) => entry.level !== value), { name: roleName(value), ...metaFor(value), ...patch, level: value }]);

  const setUser = (userId: string, value: number) => (draft.users = { ...draft.users, [userId]: value });
  const resetUser = (userId: string) => (draft.users = Object.fromEntries(Object.entries(draft.users ?? {}).filter(([id]) => id !== userId)));

  const create = () => {
    const value = free ?? base + 1;
    setMeta(value, { name: text("new_role"), color: PALETTE[roles.length % PALETTE.length] });
    open(value, "display");
  };

  const remove = (target: Role) => {
    draft.users = Object.fromEntries(Object.entries(draft.users ?? {}).filter(([, value]) => value !== target.level));
    meta = meta.filter((entry) => entry.level !== target.level);
    editing = editing && selected !== target.level;
    deleting = null;
  };

  const moveLevel = (from: number, raw: string) => {
    const to = Math.trunc(Number(raw));
    const valid = Number.isFinite(to) && to > base && to < own && !roles.some((entry) => entry.level === to);
    levelError = !valid && to !== from;
    valid &&
      ((draft.users = Object.fromEntries(Object.entries(draft.users ?? {}).map(([id, value]) => [id, value === from ? to : value]))),
      (meta = [...meta.filter((entry) => entry.level !== from), { ...(metaFor(from) ?? { name: roleName(from) }), level: to }]),
      (selected = to));
  };

  const toggle = (permission: Permission, on: boolean) => grant(draft, permission, level, on);
  const clearPermissions = () => available.filter((permission) => permAllowed(permission) && permOn(permission)).forEach((permission) => grant(draft, permission, level, false));

  const upload = (file: File | undefined) =>
    file &&
    $session &&
    ((uploading = true),
    uploadImage($session, file, file.name)
      .then((url) => setMeta(level, { icon: url }))
      .catch(() => (failed = true))
      .finally(() => ((uploading = false), picker && (picker.value = ""))));

  const addPicked = () => (picked.forEach((userId) => setUser(userId, level)), (picked = []), (picking = false));
  const pick = (userId: string) => (picked = picked.includes(userId) ? picked.filter((id) => id !== userId) : [...picked, userId]);

  const reset = () => (
    (draft = structuredClone($state.snapshot(original) as PowerLevels)),
    (meta = structuredClone(originalMeta)),
    (named = room?.name ?? ""),
    (topic = room?.topic ?? ""),
    (joinRule = originalJoin),
    (history = originalHistory),
    (encrypted = !!room?.encryption),
    (picture = null),
    (unpictured = false),
    (pictureUrl && URL.revokeObjectURL(pictureUrl)),
    (pictureUrl = null),
    pictureInput?.forget(),
    (failed = false),
    (levelError = false)
  );

  const saveDetails = async () => {
    const [nextName, nextTopic] = [named.trim(), topic.trim()];
    await Promise.all([
      nextName !== (room?.name ?? "") && sendState($session!, roomId, "m.room.name", { name: nextName }),
      nextTopic !== (room?.topic ?? "") && sendState($session!, roomId, "m.room.topic", { topic: nextTopic }),
      picture && uploadImage($session!, picture.blob, picture.file.name).then((url) => sendState($session!, roomId, "m.room.avatar", { url })),
      unpictured && !picture && sendState($session!, roomId, "m.room.avatar", {}),
      joinRule !== originalJoin && sendState($session!, roomId, "m.room.join_rules", joinRule === "restricted" ? { join_rule: joinRule, allow: parents.map((id) => ({ type: "m.room_membership", room_id: id })) } : { join_rule: joinRule }),
      history !== originalHistory && sendState($session!, roomId, "m.room.history_visibility", { history_visibility: history }),
      encrypted && !room?.encryption && sendState($session!, roomId, "m.room.encryption", { algorithm: "m.megolm.v1.aes-sha2" }),
    ]);
    savedDetails = JSON.stringify([nextName, nextTopic, joinRule, history, encrypted]);
    unpictured = false;
    picture = null;
  };

  const commit = () => {
    busy = true;
    failed = false;
    const notice = detailsChanged ? "settings_saved" : "power_saved";
    const spread: RoleSource | null = spaceSynced && room && (powerChanged || metaChanged) ? { levels: $state.snapshot(draft) as PowerLevels, roles: $state.snapshot(meta) as RoleMeta[], creators: creatorsOf(room) } : null;
    Promise.all([
      powerChanged && setPowerLevels($session!, roomId, $state.snapshot(draft) as PowerLevels),
      metaChanged && setRoles($session!, roomId, { ...stateOf(ROLES_EVENT), roles: [...($state.snapshot(meta) as RoleMeta[])].sort((a, b) => b.level - a.level) }),
      detailsChanged && saveDetails(),
    ])
      .then(() => ((savedPower = canon($state.snapshot(draft))), (savedMeta = snapshotMeta($state.snapshot(meta) as RoleMeta[])), (busy = false), (demoting = false), toastKey(notice, { icon: "check", tone: "success" }), spread && void spreadRoles(spread)))
      .catch(() => ((busy = false), (demoting = false), (failed = true)));
  };

  const spreadRoles = (source: RoleSource) => ((syncing = true), syncSpace($session!, source, spaceRooms).then(announceSync).finally(() => (syncing = false)));
  const offerSpace = $derived(room && !room.isSpace && !syncSource ? [...new Set(room.parents)].map((id) => $rooms[id]).find((space) => canOfferSync(space, me)) : undefined);
  const syncHere = () =>
    syncSource && room && $session && ((syncing = true), syncRoom($session, sourceOf(syncSource), room).then((done) => announceSync({ synced: Number(done), skipped: Number(!done) })).finally(() => (syncing = false)));

  const save = () => !busy && changed && $session && (powerChanged && ownNext < own ? (demoting = true) : commit());
  const guard = () => busy || (changed && (nudge(), true));
  const kind = $derived(room?.isSpace ? "space" : "room");
  const created = $derived(room?.state["m.room.create"]?.[""]);
  const alias = $derived(room?.state["m.room.canonical_alias"]?.[""]?.content?.alias as string | undefined);
  const facts = $derived([
    { id: "id", value: roomId, copy: true },
    { id: "version", value: String(created?.content?.room_version ?? "1"), copy: false },
    { id: "creator", value: (room ? creatorsOf(room)[0] : undefined) ?? created?.sender ?? "", copy: true },
    { id: "created", value: created?.origin_server_ts ? new Date(created.origin_server_ts).toLocaleString() : "", copy: false },
  ].filter((fact) => fact.value));
  const groups = $derived<ShellGroup<Section>[]>([
    {
      id: "settings",
      entries: [
        { id: "general", label: text("sections", "general"), icon: MENU_ICONS.info, parts: ["name", "picture", "topic", ...(alias ? ["address"] : [])].map((id) => ({ id, label: text("parts", id) })) },
        { id: "roles", label: text("sections", "roles"), icon: SETTINGS_ICONS.shield },
        { id: "access", label: text("sections", "access"), icon: SETTINGS_ICONS.privacy, parts: ["join", "history", ...(room?.isSpace ? [] : ["encryption"])].map((id) => ({ id, label: text("parts", id) })) },
        { id: "advanced", label: text("sections", "advanced"), icon: SETTINGS_ICONS.gear, parts: [{ id: "details", label: text("parts", "details") }] },
      ],
    },
  ]);
  const actions = $derived<ShellAction[]>([
    { id: "leave", label: text("leave", kind), icon: MENU_ICONS.leave, run: () => (shell?.close(), room?.isSpace ? ask("leave-space", roomId) : askLeave(roomId)) },
    ...(!room?.isSpace && closureOf(roomId).allowed ? [{ id: "delete", label: text("delete_room"), icon: ROOM_ICONS.remove, run: () => (shell?.close(), ask("delete", roomId)) }] : []),
  ]);
  const choosePicture = (blob: Blob, file: File) => (pictureUrl && URL.revokeObjectURL(pictureUrl), (pictureUrl = URL.createObjectURL(blob)), (picture = { blob, file }), (unpictured = false));
  const removePicture = () => (pictureInput?.forget(), pictureUrl && URL.revokeObjectURL(pictureUrl), (pictureUrl = null), (picture = null), (unpictured = !!room?.avatarUrl));
  const shownPicture = $derived(pictureUrl ?? (unpictured ? undefined : room?.avatarUrl));
  const editors: [string, () => unknown][] = [
    [".preview-face", () => can("m.room.avatar") && pictureInput?.open()],
    [".preview-title", () => document.getElementById("room-name")?.focus()],
    [".preview-topic", () => document.getElementById("room-topic")?.focus()],
  ];
  const editFrom = (event: MouseEvent) => editors.find(([selector]) => (event.target as Element).closest(selector))?.[1]();
  const tint = profileTint(() => ({ avatar: shownPicture }));
  $effect(() => () => void (pictureUrl && URL.revokeObjectURL(pictureUrl)));

  const openMore = (event: MouseEvent, items: MenuItem[]) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openEntityMenu(items, rect.left, rect.bottom + 4);
  };

  const roleItems = (target: Role): MenuItem[] => [
    { id: "edit", label: text("edit_role"), icon: MENU_ICONS.edit, run: () => open(target.level, "display") },
    { id: "permissions", label: text("tabs", "permissions"), icon: MENU_ICONS.settings, run: () => open(target.level, "permissions") },
    { id: "members", label: text("tabs", "members"), icon: MENU_ICONS.profile, run: () => open(target.level, "members") },
    { id: "copy-name", label: text("copy_name"), icon: MENU_ICONS.copy, separated: true, run: () => copied(target.name) },
    { id: "copy-level", label: text("copy_level"), icon: MENU_ICONS.copy, run: () => copied(String(target.level)) },
    { id: "delete", label: text("delete_role"), icon: MENU_ICONS.delete, danger: true, separated: true, disabled: !(editable && metaEditable && target.level < own), run: () => (deleting = target) },
  ];
  const everyoneItems = (): MenuItem[] => [
    { id: "everyone", label: text("tabs", "permissions"), icon: MENU_ICONS.settings, run: () => open("everyone", "permissions") },
    { id: "copy-level", label: text("copy_level"), icon: MENU_ICONS.copy, run: () => copied(String(base)) },
  ];
  const createItems = (): MenuItem[] => [{ id: "create", label: text("create"), icon: MENU_ICONS.add, disabled: !canCreate, run: create }];
  const memberItems = (userId: string): MenuItem[] => [
    { id: "remove", label: text("remove_member"), icon: MENU_ICONS.close, danger: true, disabled: !memberAllowed(userId), run: () => resetUser(userId) },
    { id: "copy-user", label: text("copy_user"), icon: MENU_ICONS.copy, separated: true, run: () => copied(userId) },
  ];
  const permItems = (permission: Permission): MenuItem[] => [
    { id: "toggle", label: text("perm", permission.key, "label"), icon: MENU_ICONS.settings, selected: permOn(permission), disabled: !permAllowed(permission), run: () => toggle(permission, !permOn(permission)) },
    { id: "copy-level", label: text("copy_level"), icon: MENU_ICONS.copy, separated: true, run: () => copied(String(permission.read(draft))) },
  ];
  const colourItems = (value: string | undefined): MenuItem[] => [
    { id: "use", label: text("colour"), icon: MENU_ICONS.edit, selected: colour === value, disabled: !displayEditable, run: () => setMeta(level, { color: value }) },
    ...(value ? [{ id: "copy", label: text("copy_colour"), icon: MENU_ICONS.copy, run: () => copied(value) }] : []),
  ];
  const tabItems = (id: Tab): MenuItem[] => [{ id, label: text("tabs", id), icon: MENU_ICONS.open, selected: activeTab === id, run: () => (tab = id) }];
  const backItems = (): MenuItem[] => [{ id: "back", label: text("back"), icon: MENU_ICONS.collapse, run: back }];
  const saveItems = (): MenuItem[] => [
    { id: "save", label: text("save"), icon: MENU_ICONS.save, disabled: busy, run: save },
    { id: "reset", label: text("reset_changes"), icon: MENU_ICONS.retry, disabled: busy, run: reset },
  ];
  const iconItems = (): MenuItem[] => [
    { id: "upload", label: text("icon_upload"), icon: MENU_ICONS.image, disabled: !displayEditable || uploading, run: () => picker?.click() },
    { id: "remove", label: text("icon_remove"), icon: MENU_ICONS.delete, danger: true, disabled: !displayEditable || !role?.icon, run: () => setMeta(level, { icon: undefined }) },
  ];
</script>

{#snippet search(value: string, label: string, set: (next: string) => void)}
  <label class="set-input search">
    <span class="faint row-nw"><Icon name="search" size={16} /></span>
    <input type="search" placeholder={label} aria-label={label} {value} oninput={(event) => set(event.currentTarget.value)} />
  </label>
{/snippet}

{#snippet badge(target: Role | undefined, size: number)}
  <span class="badge" style:--role={target?.color ?? "var(--colours-text-faint)"} style:--size="{size}px">
    {#if target?.icon}
      <Avatar name={target.name} url={target.icon} size="{size}px" radius="50%" />
    {:else}
      <Icon name="shield" size={size} />
    {/if}
  </span>
{/snippet}

{#snippet offer(space: RoomSummary, body: string)}
  <div class="sync-offer row align-centre gap-lg" role="note">
    <span class="col gap-xs flex-max min-0">
      <span class="md option-name">{text("sync", "offer_title")}</span>
      <span class="sm faint">{body}</span>
    </span>
    <Button variant="link" disabled={syncing} onclick={() => ask("sync-roles", space.roomId)}>{text("sync", syncing ? "syncing" : "enable")}</Button>
  </div>
{/snippet}

{#snippet top()}
  <div class="identity row-nw align-centre gap-sm">
    <Avatar name={room?.name ?? ""} url={shownPicture} size="40px" radius={room?.isSpace ? "28%" : "50%"} fade />
    <span class="col min-0">
      <span class="md truncate identity-name"><EmojiText text={named || room?.name || ""} live /></span>
      <span class="sm faint">{text(room?.isSpace ? "title_space" : "title_room")}</span>
    </span>
  </div>
{/snippet}

{#snippet preview()}
  <h3 class="set-label">{text("preview")}</h3>
  {#key shownPicture}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="preview-card col blur-swap" style:--swap-blur="12px" style:--swap-scale="0.98" onclick={editFrom} style:--hue={hueOf(roomId)} style:--profile-tint={tint.colour} style:--profile-glow={tint.glow}>
    <span class="preview-banner"></span>
    <span class="preview-face editable" class:squircle={room?.isSpace}><Avatar name={named || room?.name || ""} url={shownPicture} size="80px" radius={room?.isSpace ? "28%" : "50%"} /></span>
    <span class="preview-body col gap-xs">
      <span class="preview-title editable truncate"><EmojiText text={named || room?.name || ""} live /></span>
      {#if topic}<span class="sm preview-topic editable clamp">{topic}</span>{/if}
      <span class="sm preview-meta">{fill(joined.length === 1 ? "members_one" : "members_count", { count: joined.length })}{#if created?.origin_server_ts} · {fill("since", { date: new Date(created.origin_server_ts).toLocaleDateString(undefined, { month: "short", year: "numeric" }) })}{/if}</span>
    </span>
  </div>
  {/key}
{/snippet}

<SettingsShell
  bind:this={shell}
  label={text(room?.isSpace ? "title_space" : "title_room")}
  {groups}
  bind:section
  searchable
  {guard}
  {onclose}
  {top}
  {actions}
  wide={section === "roles"}
  aside={section === "general" ? preview : undefined}
>
  {#snippet children()}
    <UnsavedBar
      bind:this={bar}
      open={changed}
      {busy}
      message={text(failed ? "failed" : "unsaved")}
      resetLabel={text("reset_changes")}
      saveLabel={text(busy ? "saving" : "save")}
      disabled={!(editable || metaEditable || detailsChanged)}
      items={saveItems}
      onreset={reset}
      onsave={save}
    />
    {#if section === "general"}
      <section class="set-form col">
        <section class="set-section col gap-sm" data-part="name">
          <label class="set-heading" for="room-name">{text("details_name")}</label>
          <div class="set-input"><input id="room-name" bind:value={named} placeholder={text("details_name")} disabled={!can("m.room.name") || busy} maxlength="255" /></div>
        </section>
        <section class="set-section col gap-sm" data-part="picture">
          <h3 class="set-heading">{text("picture")}</h3>
          <ImageInput bind:this={pictureInput} shape={room?.isSpace ? "squircle" : "circle"} disabled={!can("m.room.avatar") || busy} onpick={choosePicture} />
          <div class="row gap-sm">
            <Button variant="outline" icon={MENU_ICONS.image} disabled={!can("m.room.avatar") || busy} onclick={() => pictureInput?.open()}>{text("change_picture")}</Button>
            {#if shownPicture}
              <button type="button" class="set-button quiet-danger ghost press" disabled={!can("m.room.avatar") || busy} onclick={removePicture}>{text("remove_picture")}</button>
            {/if}
          </div>
        </section>
        <section class="set-section col gap-sm" data-part="topic">
          <label class="set-heading" for="room-topic">{text("details_topic")}</label>
          <div class="set-input"><input id="room-topic" bind:value={topic} placeholder={text("details_topic_placeholder")} disabled={!can("m.room.topic") || busy} /></div>
        </section>
        {#if alias}
          <div class="set-section col" data-part="address">
            <h3 class="set-heading">{text("address")}</h3>
            <div class="set-panel row-nw align-centre gap-md">
              <span class="md flex-max truncate">{alias}</span>
              <button type="button" class="button" onclick={() => copied(alias)}>{text("copy")}</button>
            </div>
            <p class="set-hint">{text("address_hint")}</p>
          </div>
        {/if}
      </section>
    {:else if section === "roles"}
    <div class="pages" class:editing>
      <section class="page list-page col" inert={editing} aria-hidden={editing}>
        <div class="list-body col">
          <p class="set-hint">{text("intro")}</p>
          {#if room?.isSpace && editable && own >= powerRead(ROLES_EVENT)(original)}
            {#if spaceSynced}
              <div class="set-panel row-nw align-centre gap-md">
                <span class="col flex-max min-0">
                  <span class="md option-name">{text("sync", "title")}</span>
                  <span class="sm faint">{behind ? fill("sync.behind", { count: behind }) : fill("sync.on", { count: spaceRooms.length })}</span>
                </span>
                {#if behind}<Button variant="link" outlined disabled={syncing} onclick={() => spreadRoles(sourceOf(room!))}>{text("sync", "now")}</Button>{/if}
                <span class="sync-switch">
                  {#if prompt.busy && prompt.current?.id === room?.roomId}
                    <span class="sync-state" transition:haze={{ blur: 4, scale: 0.6, duration: 360 }}><LoadingDots label={text("sync", "syncing")} /></span>
                  {:else}
                    {#key prompt.current}
                      <span class="sync-state" transition:haze={{ blur: 4, scale: 0.6, duration: 360 }}><Toggle checked label={text("sync", "title")} disabled={syncing || !!prompt.current} onchange={(on) => room && ask(on ? "sync-roles" : "unsync-roles", room.roomId)} /></span>
                    {/key}
                  {/if}
                </span>
              </div>
            {:else}
              {@render offer(room, text("sync", "offer_body"))}
            {/if}
          {:else if syncSource}
            <div class="set-panel row-nw align-centre gap-md">
              <span class="col flex-max min-0">
                <span class="md option-name">{fill("sync.managed_title", { space: syncSource.name ?? "" })}</span>
                <span class="sm faint">{text("sync", roomBehind ? "managed_behind" : "managed_body")}</span>
              </span>
              {#if roomBehind && editable}<Button variant="link" outlined disabled={syncing} onclick={syncHere}>{text("sync", "now")}</Button>{/if}
              {#if spaceRolesEditable}<Button variant="link" onclick={openSpaceRoles}>{text("sync", "open_space")}</Button>{/if}
            </div>
          {:else if offerSpace}
            {@render offer(offerSpace, fill("sync.offer_room", { space: offerSpace.name ?? "" }))}
          {/if}
          <div class="reveal" class:open={!editable}>
            <p class="clip set-hint warn">{text("read_only")}</p>
          </div>

          <button type="button" class="everyone-card set-panel row-nw align-centre gap-md ghost press" onclick={() => open("everyone", "permissions")} use:menu={everyoneItems}>
            <span class="set-tile"><Icon name="members" size={20} /></span>
            <span class="col flex-max min-0">
              <span class="set-title">{text("everyone")}</span>
              <span class="sm faint truncate">{text("everyone_hint")}</span>
            </span>
            <span class="faint row-nw"><Icon name="next" size={20} /></span>
          </button>

          <div class="reveal" class:open={roles.length > 0}>
            <div class="clip">
              <div class="toolbar row-nw align-centre gap-sm">
                {@render search(query, text("search_roles"), (next) => (query = next))}
                {#if !managed}<Button variant="primary" disabled={!canCreate} onclick={create} {@attach fromAction(menu, () => createItems)}>{text("create")}</Button>{/if}
              </div>
            </div>
          </div>

          <div class="reveal" class:open={roles.length > 0}>
            <div class="clip">
              <div class="table col">
                <div class="table-head row-nw align-centre">
                  <span class="set-label flex-max">{fill("col_roles", { count: roles.length })}</span>
                  <span class="set-label count-col">{text("col_members")}</span>
                  <span class="actions-col"></span>
                </div>
                {#each shownRoles as entry (entry.level)}
                  <div class="row-wrap" transition:grow>
                    <div class="clip">
                      <div
                        class="role-row row-nw align-centre"
                        role="button"
                        tabindex="0"
                        onclick={() => open(entry.level, "display")}
                        onkeydown={(event) => event.key === "Enter" && open(entry.level, "display")}
                        use:menu={() => roleItems(entry)}
                      >
                        <span class="row-nw align-centre gap-sm flex-max min-0">
                          {@render badge(entry, 20)}
                          <span class="md truncate role-name" style:color={entry.color}>{entry.name}</span>
                        </span>
                        <span class="count-col row-nw align-centre gap-xs sm muted"><Icon name="members" size={16} />{entry.members.length}</span>
                        <span class="actions-col row-nw gap-xs">
                          <button type="button" class="round ghost press" aria-label={text("edit_role")} onclick={(event) => (event.stopPropagation(), open(entry.level, "display"))} use:menu={() => roleItems(entry)}><Icon name="edit" size={16} /></button>
                          <button type="button" class="round ghost press" aria-label={text("more")} aria-haspopup="menu" onclick={(event) => (event.stopPropagation(), openMore(event, roleItems(entry)))} use:menu={() => roleItems(entry)}><Icon name="more" size={18} /></button>
                        </span>
                      </div>
                    </div>
                  </div>
                {/each}
                <div class="reveal" class:open={!shownRoles.length}>
                  <p class="clip set-hint none">{text("no_match")}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="reveal" class:open={!roles.length}>
            <div class="clip">
              <div class="empty col align-centre gap-md">
                <span class="empty-art"><Icon name="shield" size={40} /></span>
                <h3 class="set-heading">{managed ? text("sync", "empty_title") : text("empty_title")}</h3>
                <p class="set-hint">{managed ? fill("sync.empty_body", { space: syncSource?.name ?? "" }) : text("empty_body")}</p>
                {#if !managed}
                  <Button variant="primary" disabled={!canCreate} onclick={create} {@attach fromAction(menu, () => createItems)}>{text("create")}</Button>
                {:else if spaceRolesEditable}
                  <Button variant="primary" icon={SETTINGS_ICONS.shield} onclick={openSpaceRoles}>{text("sync", "open_space")}</Button>
                {/if}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="page edit-page row-nw" inert={!editing} aria-hidden={!editing}>
        <aside class="side col">
          <div class="side-head row-nw align-centre gap-xs">
            <button type="button" class="back ghost press row-nw align-centre gap-xs flex-max" onclick={back} use:menu={backItems}><Icon name="back" size={18} />{text("back")}</button>
            <button type="button" class="round ghost press" aria-label={text("create")} disabled={!canCreate} onclick={create} use:menu={createItems}><Icon name="add" size={18} /></button>
          </div>
          <div class="side-list col">
            {#each roles as entry (entry.level)}
              <div class="row-wrap" transition:grow>
                <div class="clip">
                  <button type="button" class="side-item ghost press row-nw align-centre gap-sm" aria-current={selected === entry.level ? "page" : undefined} onclick={() => open(entry.level, activeTab === "permissions" ? "permissions" : tab)} use:menu={() => roleItems(entry)}>
                    <span class="dot" style:background-color={entry.color ?? "var(--colours-text-faint)"}></span>
                    <span class="sm truncate flex-max">{entry.name}</span>
                  </button>
                </div>
              </div>
            {/each}
            <button type="button" class="side-item ghost press row-nw align-centre gap-sm" aria-current={everyone ? "page" : undefined} onclick={() => open("everyone", "permissions")} use:menu={everyoneItems}>
              <span class="dot"></span>
              <span class="sm truncate flex-max">{text("everyone_role")}</span>
            </button>
          </div>
        </aside>

        <main class="editor col flex-max min-0">
          <div class="editor-head col">
            <div class="row-nw align-centre gap-sm">
              <button type="button" class="round ghost press mobile-back" aria-label={text("back")} onclick={back} use:menu={backItems}><Icon name="back" size={20} /></button>
              <h3 class="set-title truncate flex-max">{fill("edit_title", { name: everyone ? text("everyone_role") : (role?.name ?? "") })}</h3>
              <button type="button" class="round ghost press" class:hidden={everyone} aria-label={text("more")} aria-haspopup="menu" disabled={everyone || !role} onclick={(event) => role && openMore(event, roleItems(role))} use:menu={() => (role ? roleItems(role) : [])}><Icon name="more" size={18} /></button>
            </div>
            <div class="tabs" role="tablist" style:--count={tabs.length} style:--index={tabs.indexOf(activeTab)}>
              {#each tabs as id (id)}
                <button type="button" role="tab" class="tab ghost press sm" aria-selected={activeTab === id} onclick={() => (tab = id)} use:menu={() => tabItems(id)}>
                  {id === "members" ? text("tabs", "members_count").replace("{count}", String(role?.members.length ?? 0)) : text("tabs", id)}
                </button>
              {/each}
              <span class="tab-mark" aria-hidden="true"></span>
            </div>
          </div>

          <div class="editor-body col">
            <div class="reveal" class:open={activeTab === "display"} inert={activeTab !== "display"}>
              <div class="clip">
                <div class="panel col">
                  <label class="field col">
                    <span class="set-label">{text("name")}</span>
                    <span class="set-input">
                      <input type="text" maxlength="64" value={role?.name ?? ""} disabled={!displayEditable} oninput={(event) => setMeta(level, { name: event.currentTarget.value })} />
                    </span>
                  </label>

                  <label class="field col">
                    <span class="set-label">{text("level")}</span>
                    <span class="set-input">
                      <input type="number" step="1" min={base + 1} max={own - 1} value={level} disabled={!(roleEditable && metaEditable)} onchange={(event) => moveLevel(level, event.currentTarget.value)} />
                    </span>
                    <span class="sm faint">{fill("level_hint", { min: base + 1, max: own - 1 })}</span>
                    <span class="reveal" class:open={levelError}><span class="clip sm error" role="alert">{text("level_taken")}</span></span>
                  </label>

                  <div class="field col">
                    <span class="set-label">{text("colour")}</span>
                    <span class="sm faint">{text("colour_hint")}</span>
                    <div class="colours row-nw gap-md">
                      <button type="button" class="big-swatch ghost press" class:on={!colour} aria-label={text("colour_default")} disabled={!displayEditable} onclick={() => setMeta(level, { color: undefined })} use:menu={() => colourItems(undefined)}>
                        <span class="check"><Icon name="check" size={20} /></span>
                      </button>
                      <button type="button" class="big-swatch custom ghost press" class:on={!!colour && !PALETTE.includes(colour)} style:background-color={colour && !PALETTE.includes(colour) ? colour : undefined} aria-label={text("colour_custom")} aria-expanded={!!colourAnchor} disabled={!displayEditable} use:menu={() => colourItems(colour)} onclick={(event) => (colourAnchor = colourAnchor ? null : event.currentTarget)}>
                        <span class="check"><Icon name="check" size={20} /></span>
                        <span class="pen"><Icon name="appearance" size={14} /></span>
                      </button>
                      {#if colourAnchor}
                        <ColourPopover anchor={colourAnchor} value={colour ?? "#99aab5"} onchange={(value) => setMeta(level, { color: value })} onclose={() => (colourAnchor = null)} />
                      {/if}
                      <div class="palette">
                        {#each PALETTE as swatch (swatch)}
                          <button type="button" class="swatch ghost press" class:on={colour === swatch} style:background-color={swatch} aria-label={swatch} disabled={!displayEditable} onclick={() => setMeta(level, { color: swatch })} use:menu={() => colourItems(swatch)}>
                            <span class="check"><Icon name="check" size={14} /></span>
                          </button>
                        {/each}
                      </div>
                    </div>
                  </div>

                  <div class="field col">
                    <span class="set-label">{text("icon")}</span>
                    <span class="sm faint">{text("icon_hint")}</span>
                    <div class="row-nw align-centre gap-md">
                      <span class="set-tile icon-tile" use:menu={iconItems}>{@render badge(role, 24)}</span>
                      <Button disabled={!displayEditable || uploading} onclick={() => picker?.click()} {@attach fromAction(menu, () => iconItems)}>{text(uploading ? "icon_uploading" : "icon_upload")}</Button>
                      <Button variant="quiet-danger" class={["fade", { gone: !role?.icon }]} disabled={!displayEditable || !role?.icon} onclick={() => setMeta(level, { icon: undefined })} {@attach fromAction(menu, () => iconItems)}>{text("icon_remove")}</Button>
                      <input class="file" type="file" accept="image/*" bind:this={picker} onchange={(event) => upload(event.currentTarget.files?.[0])} />
                    </div>
                  </div>

                  <div class="field col">
                    <span class="set-label">{text("preview_label")}</span>
                    <div class="preview set-panel row-nw gap-md">
                      <Avatar name={nameOf(me)} url={avatarOf(me)} size="40px" radius="50%" />
                      <span class="col min-0">
                        <span class="row-nw align-centre gap-xs">
                          <span class="md bold truncate preview-name" style:color={colour}><EmojiText text={nameOf(me)} /></span>
                          {#if role?.icon}{@render badge(role, 16)}{/if}
                        </span>
                        <span class="md">{text("preview_text")}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="reveal" class:open={activeTab === "permissions"} inert={activeTab !== "permissions"}>
              <div class="clip">
                <div class="panel col">
                  <div class="row-nw align-centre gap-sm">
                    {@render search(permQuery, text("search_permissions"), (next) => (permQuery = next))}
                    <Button disabled={!roleEditable} onclick={clearPermissions} {@attach fromAction(menu, () => () => [{ id: "clear", label: text("clear_permissions"), icon: MENU_ICONS.retry, disabled: !roleEditable, run: clearPermissions }])}>{text("clear_permissions")}</Button>
                  </div>
                  {#each permGroups as { group, items } (group)}
                    <div class="reveal" class:open={items.length > 0}>
                      <div class="clip">
                        <div class="perm-group col">
                          <span class="set-label">{text("groups", group)}</span>
                          {#each items as permission (permission.key)}
                            <div class="row-wrap" transition:grow>
                              <div class="clip">
                                <div class="perm row-nw align-centre gap-lg" use:menu={() => permItems(permission)}>
                                  <span class="col flex-max min-0">
                                    <span class="md perm-label">{text("perm", permission.key, "label")}</span>
                                    <span class="sm faint">{text("perm", permission.key, "hint")}</span>
                                  </span>
                                  <Toggle checked={permOn(permission)} label={text("perm", permission.key, "label")} disabled={!permAllowed(permission)} onchange={(on) => toggle(permission, on)} />
                                </div>
                              </div>
                            </div>
                          {/each}
                        </div>
                      </div>
                    </div>
                  {/each}
                  <div class="reveal" class:open={permGroups.every((entry) => !entry.items.length)}>
                    <p class="clip set-hint">{text("no_permissions")}</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="reveal" class:open={activeTab === "members"} inert={activeTab !== "members"}>
              <div class="clip">
                <div class="panel col">
                  <div class="row-nw align-centre gap-sm">
                    {@render search(memberQuery, text("search_members"), (next) => (memberQuery = next))}
                    <Button variant="primary" disabled={!roleEditable || managed} onclick={() => ((picked = []), (pickQuery = ""), (picking = true))} {@attach fromAction(menu, () => () => [{ id: "add", label: text("add_members"), icon: MENU_ICONS.add, disabled: !roleEditable, run: () => (picking = true) }])}>{text("add_members")}</Button>
                  </div>
                  <div class="col">
                    {#each roleMembers as userId (userId)}
                      <div class="row-wrap" transition:grow>
                        <div class="clip">
                          <div class="member row-nw align-centre gap-sm" use:menu={() => memberItems(userId)}>
                            <Avatar name={nameOf(userId)} url={avatarOf(userId)} size="32px" radius="50%" />
                            <span class="col min-0 flex-max">
                              <span class="sm bold truncate"><EmojiText text={nameOf(userId)} /></span>
                              <span class="xs faint truncate">{userId}</span>
                            </span>
                            <button type="button" class="round ghost press" aria-label={text("remove_member")} disabled={!memberAllowed(userId)} onclick={() => resetUser(userId)} use:menu={() => memberItems(userId)}><Icon name="close" size={16} /></button>
                          </div>
                        </div>
                      </div>
                    {/each}
                    <div class="reveal" class:open={!roleMembers.length}>
                      <p class="clip set-hint none">{text(role?.members.length ? "no_member_match" : "no_role_members")}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </section>
    </div>
    {:else if section === "access"}
      <section class="set-form col">
        <div class="set-section col" data-part="join">
          <h3 class="set-heading">{text("join_title")}</h3>
          <p class="set-hint">{text("join_hint", kind)}</p>
          <div class="set-panel col options">
            {#each joinRules as rule (rule)}
              <button type="button" class="option ghost press row-nw align-start gap-md" class:selected={joinRule === rule} disabled={!can("m.room.join_rules") || busy} onclick={() => (joinRule = rule)}>
                <span class="radio" aria-hidden="true"></span>
                <span class="col">
                  <span class="md option-name">{text("join", rule, "name")}</span>
                  <span class="sm faint">{text("join", rule, "hint")}</span>
                </span>
              </button>
            {/each}
          </div>
        </div>
        <div class="set-section col" data-part="history">
          <h3 class="set-heading">{text("history_title")}</h3>
          <p class="set-hint">{text("history_hint")}</p>
          <div class="set-choice" role="radiogroup" aria-label={text("history_title")} style:--index={HISTORY.indexOf(history)} style:--count={HISTORY.length}>
            <span class="set-thumb" aria-hidden="true"></span>
            {#each HISTORY as option (option)}
              <button type="button" class="set-choice-option ghost press sm bold" role="radio" aria-checked={history === option} disabled={!can("m.room.history_visibility") || busy} onclick={() => (history = option)}>{text("history", option)}</button>
            {/each}
          </div>
        </div>
        {#if !room?.isSpace}
          <div class="set-section col" data-part="encryption">
            <h3 class="set-heading">{text("parts", "encryption")}</h3>
            <div class="set-panel row-nw align-centre gap-lg">
              <span class="col flex-max">
                <span class="md option-name">{text("encryption_title")}</span>
                <span class="sm faint">{text(room?.encryption ? "encryption_on" : "encryption_hint")}</span>
              </span>
              <Toggle checked={encrypted} label={text("encryption_title")} disabled={!!room?.encryption || !can("m.room.encryption") || busy} onchange={(value) => (encrypted = value)} />
            </div>
          </div>
        {/if}
      </section>
    {:else}
      <SettingsSection id="details" title={text("parts", "details")}>
        <div class="set-rows">
          {#each facts as fact (fact.id)}
            <SettingsRow
              label={text("facts", fact.id)}
              value={fact.value}
              mono={fact.copy}
              action={fact.copy ? text("copy") : undefined}
              icon={MENU_ICONS.copy}
              onaction={() => copied(fact.value)}
              items={fact.copy ? () => [{ id: "copy", label: text("copy"), icon: MENU_ICONS.copy, run: () => copied(fact.value) }] : undefined}
            />
          {/each}
        </div>
      </SettingsSection>
    {/if}
  {/snippet}
</SettingsShell>

{#if picking}
  <ConfirmDialog title={fill("add_title", { name: role?.name ?? "" })} cancelLabel={text("cancel")} tone="primary" onclose={() => (picking = false)}>
    <div class="picker set-surface col gap-sm">
      {@render search(pickQuery, text("search_members"), (next) => (pickQuery = next))}
      <div class="pick-list col">
        {#each candidates as userId (userId)}
          <button type="button" class="pick-row ghost press row-nw align-centre gap-sm" aria-pressed={picked.includes(userId)} onclick={() => pick(userId)} use:menu={() => [{ id: "pick", label: nameOf(userId), icon: MENU_ICONS.add, selected: picked.includes(userId), run: () => pick(userId) }, { id: "copy", label: text("copy_user"), icon: MENU_ICONS.copy, run: () => copied(userId) }]}>
            <Avatar name={nameOf(userId)} url={avatarOf(userId)} size="28px" radius="50%" />
            <span class="col min-0 flex-max">
              <span class="sm bold truncate"><EmojiText text={nameOf(userId)} /></span>
              <span class="xs faint truncate">{userId}</span>
            </span>
            <span class="tick"><Icon name="check" size={14} /></span>
          </button>
        {:else}
          <p class="set-hint">{text("no_candidates")}</p>
        {/each}
      </div>
    </div>
    {#snippet actions()}
      <button type="button" class="button primary" disabled={!picked.length} onclick={addPicked}>{text("add")}</button>
    {/snippet}
  </ConfirmDialog>
{/if}

{#if deleting}
  <ConfirmDialog title={fill("delete_title", { name: deleting.name })} body={text("delete_body")} cancelLabel={text("cancel")} confirmLabel={text("delete_confirm")} onconfirm={() => deleting && remove(deleting)} onclose={() => (deleting = null)} />
{/if}


{#if demoting}
  <ConfirmDialog title={text("demote_title")} body={text("demote_body")} cancelLabel={text("cancel")} confirmLabel={text("demote_confirm")} {busy} onconfirm={commit} onclose={() => (demoting = false)} />
{/if}

<style>
  .identity {
    width: 100%;
    min-height: 56px;
    padding: 4px 8px;
  }

  .identity-name,
  .option-name,
  .options {
    padding: var(--azure-spacing-xs);
  }

  .option {
    padding: var(--azure-spacing-md);
    border-radius: var(--azure-radius-sm);
    text-align: left;
  }

  .option:hover:not(:disabled) {
    background-color: var(--colours-surface-hover);
  }

  .option:disabled {
    cursor: default;
  }

  .radio {
    flex: none;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px var(--colours-text-muted);
    transition: box-shadow var(--azure-duration-md) var(--azure-ease-spring);
  }

  .option.selected .radio {
    box-shadow: inset 0 0 0 2px var(--colours-accent), inset 0 0 0 5px var(--card), inset 0 0 0 10px var(--colours-accent);
  }

  .clamp {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .preview-card {
    --tint: var(--profile-tint, oklch(0.62 0.13 var(--hue)));
    margin-top: var(--azure-spacing-sm);
    overflow: hidden;
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-foreground);
    box-shadow: 0 16px 40px -18px black;
  }

  .preview-banner {
    height: 88px;
    background:
      radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--tint) 70%, transparent), transparent 60%),
      linear-gradient(135deg, oklch(0.62 0.13 var(--hue)), color-mix(in oklab, oklch(0.45 0.1 calc(var(--hue) + 40)) 80%, var(--colours-foreground)));
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  .preview-face {
    display: flex;
    width: fit-content;
    margin: -40px 0 var(--azure-spacing-xs) var(--azure-spacing-md);
    border: 5px solid var(--colours-foreground);
    border-radius: 50%;
    background-color: var(--colours-foreground);
    box-shadow: 0 0 24px var(--profile-glow, color-mix(in oklab, oklch(0.62 0.13 var(--hue)) 55%, transparent));
  }

  .preview-face.squircle {
    border-radius: 32%;
  }

  .preview-body {
    padding: 0 var(--azure-spacing-md) var(--azure-spacing-md);
  }

  .editable {
    cursor: pointer;
    transition: filter 200ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .editable:hover {
    filter: brightness(1.15);
  }

  .preview-title {
    font-size: var(--text-lg);
    font-weight: 500;
    color: var(--colours-text-strong);
  }

  .preview-topic {
    color: var(--colours-text);
  }

  .preview-meta {
    color: var(--colours-text-muted);
  }

  .round {
    width: 32px;
    height: 32px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--colours-text-faint);
    transition:
      opacity 320ms var(--sheet),
      background-color 200ms var(--sheet),
      color 200ms var(--sheet);
  }

  .round:hover:not(:disabled) {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .round:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .round.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .pages {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: 100% 100%;
    grid-template-rows: minmax(0, 1fr);
    overflow: hidden;
  }

  .page {
    grid-row: 1;
    min-width: 0;
    min-height: 0;
    transition:
      transform 520ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity 520ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .list-page {
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .edit-page {
    transform: translateX(8%);
    opacity: 0;
  }

  .editing .list-page {
    transform: translateX(-100%) scale(0.98);
    opacity: 0;
  }

  .editing .edit-page {
    transform: translateX(-100%);
    opacity: 1;
  }

  .list-body {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    gap: 20px;
    padding: 32px 24px 112px;
  }

  .sync-switch {
    display: grid;
    place-items: center;
    min-width: 44px;
  }

  .sync-state {
    grid-area: 1 / 1;
    display: flex;
  }

  .sync-offer {
    padding: var(--azure-spacing-md) var(--azure-spacing-md) var(--azure-spacing-md) var(--azure-spacing-lg);
    border-radius: var(--azure-radius-md);
    border: 1px solid color-mix(in oklab, var(--colours-accent) 35%, transparent);
    background-color: var(--colours-accent-faint);
  }

  .warn {
    color: var(--colours-text);
  }

  .everyone-card {
    width: 100%;
    text-align: left;
    transition: background-color 200ms var(--sheet);
  }

  .everyone-card:hover {
    background-color: var(--fill);
  }

  .toolbar .search {
    flex: 1;
  }

  .search {
    flex: 1;
    min-width: 0;
  }

  .search input {
    font-size: max(16px, var(--text-sm));
  }

  .table-head {
    padding: 0 8px 8px;
    border-bottom: 1px solid var(--line);
  }

  .count-col {
    width: 96px;
    flex: none;
  }

  .actions-col {
    width: 72px;
    flex: none;
    justify-content: flex-end;
  }

  .row-wrap {
    display: grid;
    grid-template-rows: 1fr;
  }

  .role-row {
    min-height: 56px;
    padding: 0 8px;
    border-radius: 8px;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    transition: background-color 200ms var(--sheet);
  }

  .role-row:hover {
    background-color: var(--colours-surface-hover);
  }

  .role-name {
    font-weight: 500;
    color: var(--colours-text-strong);
    transition: color 320ms var(--sheet);
  }

  .badge {
    width: var(--size);
    height: var(--size);
    flex: none;
    display: grid;
    place-items: center;
    color: var(--role);
    transition: color 320ms var(--sheet);
  }

  .none {
    padding: 16px 8px;
  }

  .empty {
    padding: 48px 24px;
    text-align: center;
  }

  .empty-art {
    width: 88px;
    height: 88px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--colours-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 14%, transparent);
  }

  .side {
    width: 232px;
    flex: none;
    min-height: 0;
    padding: 16px 12px;
    gap: 8px;
    border-right: 1px solid var(--line);
    overflow-y: auto;
    scrollbar-width: none;
  }

  .back {
    min-height: 32px;
    padding: 0 8px;
    border-radius: 8px;
    font-weight: 500;
    color: var(--colours-text-muted);
    transition:
      color 200ms var(--sheet),
      background-color 200ms var(--sheet);
  }

  .back:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .side-item {
    width: 100%;
    min-height: 36px;
    padding: 0 10px;
    border-radius: 8px;
    text-align: left;
    color: var(--colours-text-muted);
    transition:
      color 200ms var(--sheet),
      background-color 320ms var(--sheet);
  }

  .side-item:hover {
    color: var(--colours-text);
    background-color: var(--colours-surface-hover);
  }

  .side-item[aria-current="page"] {
    color: var(--colours-text-strong);
    background-color: color-mix(in oklab, white 13%, var(--card));
  }

  .dot {
    width: 12px;
    height: 12px;
    flex: none;
    border-radius: 50%;
    background-color: var(--colours-text-faint);
    transition: background-color 320ms var(--sheet);
  }

  .editor {
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .editor-head {
    position: sticky;
    top: 0;
    z-index: 2;
    gap: 12px;
    padding: 20px 24px 0;
    background-color: var(--card);
  }

  .mobile-back {
    display: none;
  }

  .tabs {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--count), minmax(0, 1fr));
    max-width: calc(var(--count) * 200px);
    border-bottom: 1px solid var(--line);
  }

  .tab {
    min-height: 40px;
    padding: 0;
    white-space: nowrap;
    font-weight: 500;
    color: var(--colours-text-muted);
    transition: color 320ms var(--sheet);
  }

  .tab:hover,
  .tab[aria-selected="true"] {
    color: var(--colours-text-strong);
  }

  .tab-mark {
    position: absolute;
    left: 0;
    bottom: -1px;
    width: calc(100% / var(--count));
    height: 2px;
    transform: translateX(calc(var(--index) * 100%));
    border-radius: 2px;
    background-color: var(--colours-accent);
    pointer-events: none;
    transition:
      transform 420ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .editor-body {
    padding: 0 24px 112px;
  }

  .panel {
    gap: 28px;
    padding-top: 24px;
  }

  .field {
    gap: 8px;
  }

  .field input:disabled {
    opacity: 0.6;
  }

  .error {
    color: var(--colours-danger);
  }

  .colours {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .big-swatch {
    position: relative;
    width: 64px;
    height: 52px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 8px;
    border: 1px solid var(--line);
    color: white;
    background-color: var(--fill);
    cursor: pointer;
    transition: background-color 320ms var(--sheet);
  }

  .big-swatch:first-child {
    background-color: #99aab5;
  }

  .pen {
    position: absolute;
    top: 4px;
    right: 4px;
    display: grid;
    color: white;
    pointer-events: none;
  }

  .palette {
    display: grid;
    grid-template-columns: repeat(10, 22px);
    gap: 8px;
  }

  .swatch {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 4px;
    color: white;
    transition: transform 320ms var(--sheet);
  }

  .swatch:hover:not(:disabled) {
    transform: scale(1.12);
  }

  .swatch:disabled,
  .big-swatch:disabled {
    cursor: default;
  }

  .check {
    display: grid;
    pointer-events: none;
    opacity: 0;
    transform: scale(0.6);
    transition:
      opacity 320ms var(--sheet),
      transform 320ms var(--sheet);
  }

  .on .check {
    opacity: 1;
    transform: scale(1);
  }

  .icon-tile {
    width: 52px;
    height: 52px;
  }

  .file {
    display: none;
  }

  .pages :global(.fade) {
    transition: opacity 320ms var(--sheet);
  }

  .pages :global(.fade.gone) {
    opacity: 0;
    pointer-events: none;
  }

  .preview {
    align-items: flex-start;
  }

  .preview-name {
    color: var(--colours-text-strong);
    transition: color 320ms var(--sheet);
  }

  .perm-group {
    gap: 4px;
  }

  .perm {
    min-height: 64px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }

  .perm-label {
    font-weight: 500;
    color: var(--colours-text-strong);
  }

  .member {
    min-height: 52px;
    padding: 4px 8px;
    border-radius: 8px;
    transition: background-color 200ms var(--sheet);
  }

  .member:hover {
    background-color: var(--colours-surface-hover);
  }

  .reveal {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows 420ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity 420ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .reveal.open {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  .clip {
    min-height: 0;
    margin: 0;
    overflow: hidden;
  }

  .dialog-link {
    min-height: 36px;
    padding: 0 12px;
    border-radius: 8px;
    color: var(--colours-text);
  }

  .dialog-link:hover:not(:disabled) {
    text-decoration: underline;
  }

  .picker {
    min-width: 0;
  }

  .pick-list {
    max-height: 50vh;
    overflow-y: auto;
  }

  .pick-row {
    min-height: 44px;
    padding: 4px 8px;
    border-radius: 8px;
    text-align: left;
    transition: background-color 200ms var(--sheet);
  }

  .pick-row:hover,
  .pick-row[aria-pressed="true"] {
    background-color: var(--colours-surface-hover);
  }

  .tick {
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    border: 1px solid var(--line);
    color: transparent;
    transition:
      background-color 320ms var(--sheet),
      color 320ms var(--sheet);
  }

  [aria-pressed="true"] .tick {
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
  }

  @media (max-width: 767px) {

    .round {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }

    .side {
      display: none;
    }

    .mobile-back {
      display: grid;
    }

    .list-body,
    .editor-head,
    .editor-body {
      padding-left: 16px;
      padding-right: 16px;
    }

    .count-col {
      width: 56px;
    }

    .actions-col {
      width: auto;
    }

    .actions-col .round:first-child {
      display: none;
    }

    .palette {
      grid-template-columns: repeat(10, minmax(0, 1fr));
      width: 100%;
    }

    .swatch {
      width: 100%;
      height: auto;
      aspect-ratio: 1;
    }

    .savebar {
      bottom: calc(12px + env(safe-area-inset-bottom));
    }
  }
</style>
