import { useState } from "react";
import { KeyRound, Loader2, X } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import {
  claimOwnership,
  removeOwnerDevice,
  signInOwner,
  signOutOwner,
  type OwnerState,
} from "@/lib/owner-client";
import { PROJECT_URL } from "@/lib/project";

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function SetupCodeForm({
  submitLabel,
  onSubmit,
  busy,
}: {
  submitLabel: string;
  onSubmit: (code: string) => void;
  busy: boolean;
}) {
  const [code, setCode] = useState("");
  const submit = () => {
    if (code.trim() && !busy) onSubmit(code);
  };
  return (
    <div className="owner-code-form">
      <input
        type="password"
        aria-label="Setup code"
        placeholder="Setup code"
        autoComplete="off"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          submit();
        }}
        className="dialog-input owner-code-input"
      />
      <button type="button" className="owner-button owner-button--primary" disabled={busy || !code.trim()} onClick={submit}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
        {submitLabel}
      </button>
    </div>
  );
}

export function OwnerPanel({
  owner,
  onAddDevice,
  framed,
}: {
  owner: OwnerState;
  onAddDevice: () => void;
  framed?: boolean;
}) {
  const { busy, error, run } = useAction();
  const [recovering, setRecovering] = useState(false);

  if (owner.status === "loading") return null;
  const tileClass = framed ? "setup-dialog-card setup-dialog-tile setup-dialog-tile--owner" : "setup-dialog-tile";

  if (owner.status === "owner") {
    return (
      <div className={tileClass}>
        <span className="setup-dialog-tile-label">Your devices</span>
        <ul className="owner-devices">
          {owner.devices.map((device) => (
            <li key={device.id} className="owner-device">
              <span className="owner-device-name">{device.label}</span>
              {device.current ? (
                <span className="owner-device-meta">This device</span>
              ) : (
                <Hint label="Sign out this device">
                  <button
                    type="button"
                    className="board-history-action"
                    aria-label={`Sign out ${device.label}`}
                    disabled={busy}
                    onClick={() => void run(() => removeOwnerDevice(device.id))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </Hint>
              )}
            </li>
          ))}
        </ul>
        <div className="owner-actions">
          <button type="button" className="owner-button" onClick={onAddDevice}>
            Add a device
          </button>
          <button type="button" className="owner-button owner-button--quiet" disabled={busy} onClick={() => void run(signOutOwner)}>
            Sign out
          </button>
        </div>
        {error ? <p className="owner-error">{error}</p> : null}
      </div>
    );
  }

  if (!owner.claimed && !owner.claimable) {
    return (
      <div className={tileClass}>
        <span className="setup-dialog-tile-label">This is the demo</span>
        <span className="bookmarklet-hint">
          Boards here are shared as links and never stored. Run your own copy to publish images and PIN boards.
        </span>
        <div className="owner-actions">
          <a className="owner-button owner-button--primary" href={PROJECT_URL} target="_blank" rel="noopener noreferrer">
            Get your own
          </a>
        </div>
      </div>
    );
  }

  if (!owner.claimed) {
    return (
      <div className={tileClass}>
        <span className="setup-dialog-tile-label">Make this Shareboard yours</span>
        <span className="bookmarklet-hint">
          Enter the setup code you chose when deploying. A passkey on this device becomes your key to publish.
        </span>
        <SetupCodeForm submitLabel="Claim" busy={busy} onSubmit={(code) => void run(() => claimOwnership(code))} />
        {error ? <p className="owner-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={tileClass}>
      <span className="setup-dialog-tile-label">Owner</span>
      <span className="bookmarklet-hint">
        Sign in to publish boards with images, PIN links and Send. Anyone can share text and link boards.
      </span>
      {recovering ? (
        <>
          <span className="bookmarklet-hint">
            Your setup code replaces every passkey and signs out your other devices.
          </span>
          <SetupCodeForm submitLabel="Reset" busy={busy} onSubmit={(code) => void run(() => claimOwnership(code))} />
        </>
      ) : (
        <div className="owner-actions">
          <button type="button" className="owner-button owner-button--primary" disabled={busy} onClick={() => void run(signInOwner)}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            Sign in with passkey
          </button>
          <button type="button" className="owner-button owner-button--quiet" onClick={() => setRecovering(true)}>
            Lost access?
          </button>
        </div>
      )}
      {error ? <p className="owner-error">{error}</p> : null}
    </div>
  );
}
