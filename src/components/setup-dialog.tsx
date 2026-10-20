import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EMPTY_PROFILE_DRAFT, saveProfileDraft } from "@/lib/store";
import { ProfileFields } from "@/components/profile-fields";
import { OwnerPanel } from "@/components/owner-panel";
import { useOwner } from "@/lib/owner-client";

export function SetupCards({ onComplete }: { onComplete: () => void }) {
  const [profile, setProfile] = useState(EMPTY_PROFILE_DRAFT);
  const [closing, setClosing] = useState(false);
  const owner = useOwner();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile.name.trim() || closing) return;
    saveProfileDraft(profile);
    setClosing(true);
    window.setTimeout(onComplete, 180);
  };

  return (
    <div className="setup-stage" data-closing={closing || undefined}>
      <form
        onSubmit={handleSubmit}
        className="setup-dialog-board"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        data-protonpass-ignore
        data-form-type="other"
      >
        <div className="setup-dialog-card setup-dialog-header-cell">
          <h2 className="font-heading text-lg leading-none font-medium text-balance">
            Welcome to Shareboard
          </h2>
          <p className="text-sm text-muted-foreground mt-2 text-pretty">
            A canvas for links, notes, and images. Arrange on the grid and share one link.
          </p>
        </div>

        <ProfileFields
          framed
          nameId="setup-name"
          nameAutoFocus
          value={profile}
          onChange={setProfile}
        />

        {owner.status === "visitor" && !owner.claimed && owner.claimable ? (
          <OwnerPanel owner={owner} onAddDevice={() => undefined} framed />
        ) : null}

        {profile.name.length > 0 && (
          <div className="setup-dialog-submit-cell">
            <Button
              type="submit"
              disabled={!profile.name.trim() || closing}
              className="h-11 w-full rounded-full text-[14px] font-medium bg-foreground hover:bg-foreground/90 text-background"
            >
              Go to canvas
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
