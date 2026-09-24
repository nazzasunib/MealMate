"use client";

import * as React from "react";
import { Database, Upload } from "lucide-react";
import { changePasswordAction, importLegacyDataAction, resetAllDataAction, updateProfileAction } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { PictureField, useAction } from "@/components/client-shared";

export function ProfileForm({ name: initialName, email, avatarUrl }: { name: string; email: string; avatarUrl: string | null }) {
  const { run, pending } = useAction();
  const [name, setName] = React.useState(initialName);
  const [avatar, setAvatar] = React.useState(avatarUrl);
  return (
    <Card className="p-6">
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateProfileAction({ name, avatarUrl: avatar }), { success: "Profile updated." });
        }}
      >
        <h2 className="text-sm font-semibold text-foreground">Profile</h2>
        <PictureField value={avatar} onChange={setAvatar} name={name} color="#0b1f4b" />
        <Field label="Display Name" htmlFor="p-name">
          <Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="p-email">
          <Input id="p-email" value={email} disabled />
        </Field>
        <Button type="submit" className="w-full" loading={pending}>
          Save Profile
        </Button>
      </form>
    </Card>
  );
}

export function PasswordForm() {
  const { run, pending } = useAction();
  const ref = React.useRef<HTMLFormElement>(null);
  return (
    <Card className="p-6">
      <form
        ref={ref}
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const ok = await run(
            () =>
              changePasswordAction({
                current: String(fd.get("current")),
                next: String(fd.get("next")),
                confirm: String(fd.get("confirm")),
              }),
            { success: "Password updated." },
          );
          if (ok) ref.current?.reset();
        }}
      >
        <h2 className="text-sm font-semibold text-foreground">Change Password</h2>
        <Field label="Current Password" htmlFor="pw-current">
          <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
        </Field>
        <Field label="New Password" htmlFor="pw-next">
          <Input id="pw-next" name="next" type="password" autoComplete="new-password" required minLength={6} />
        </Field>
        <Field label="Confirm New Password" htmlFor="pw-confirm">
          <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <Button type="submit" className="w-full" loading={pending}>
          Update Password
        </Button>
      </form>
    </Card>
  );
}

export function LegacyImport() {
  const { run, pending } = useAction();
  const [raw, setRaw] = React.useState("");
  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy-900">
            <Database className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Import from the old MealMate (index.html)</h2>
            <p className="mt-1 text-sm text-muted">
              Open the old app in the same browser you used before, press <kbd className="rounded bg-gray-100 px-1">F12</kbd> → Console, run{" "}
              <code className="rounded bg-gray-100 px-1 text-xs">copy(localStorage.getItem(&quot;mealmate_db_v2&quot;))</code>, then paste below — or
              upload a saved <code className="text-xs">.json</code> file. Works only on an empty account.
            </p>
          </div>
        </div>
        <Textarea rows={5} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder='{"members":[...],"meals":[...],...}' aria-label="Legacy data JSON" className="font-mono text-xs" />
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium hover:bg-gray-100">
            <Upload className="h-4 w-4" /> Choose file
            <input
              type="file"
              accept="application/json,.json,.txt"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) setRaw(await f.text());
              }}
            />
          </label>
          <Button
            loading={pending}
            disabled={!raw.trim()}
            onClick={() =>
              run(() => importLegacyDataAction(raw), {
                onSuccess: () => setRaw(""),
                success: "Import complete — your old MealMate data is now in the database.",
              })
            }
          >
            Import Data
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function DangerZone() {
  const { run, pending } = useAction();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  return (
    <Card className="border-danger-100 p-6">
      <h2 className="text-sm font-semibold text-danger-700">Reset all data</h2>
      <p className="mt-1 text-sm text-muted">
        Permanently deletes all members, meals, deposits, expenses, shopping list, stock and month closings for this account. Your login is kept.
      </p>
      <Button
        variant="danger"
        className="mt-4"
        onClick={() => {
          setText("");
          setOpen(true);
        }}
      >
        Reset all data
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Reset all MealMate data?" description="This cannot be undone.">
        <Field label="Type RESET to confirm" htmlFor="reset-confirm">
          <Input id="reset-confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </Field>
        <div className="mt-5">
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={text !== "RESET"}
              onClick={async () => {
                if (await run(() => resetAllDataAction(text), { success: "All data was reset." })) setOpen(false);
              }}
            >
              Delete everything
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </Card>
  );
}
