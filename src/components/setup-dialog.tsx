
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setName, setProfile } from "@/lib/store";
import { X as XIcon } from "@/components/ui/svgs/x";
import { InstagramIcon } from "@/components/ui/svgs/instagramIcon";
import { Linkedin } from "@/components/ui/svgs/linkedin";

const ignoreAttrs = {
  autoComplete: "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
  "data-protonpass-ignore": true,
} as const;

export function SetupCards({ onComplete }: { onComplete: () => void }) {
  const [name, setNameValue] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [closing, setClosing] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || closing) return;
    setName(name.trim());
    setProfile({ xUrl, instagramUrl, linkedinUrl });
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

        <div className="setup-dialog-card setup-dialog-tile setup-dialog-tile--name">
          <span className="setup-dialog-tile-label">Display name</span>
          <input
            id="setup-name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setNameValue(e.target.value)}
            autoFocus
            enterKeyHint="next"
            autoCapitalize="words"
            {...ignoreAttrs}
            className="setup-dialog-tile-input"
          />
        </div>

        <div className="setup-dialog-card setup-dialog-tile setup-dialog-tile--socials">
          <span className="setup-dialog-tile-label">
            Social links
            <span className="setup-dialog-tile-label-muted">(optional)</span>
          </span>
          <div className="setup-dialog-social-list">
            <div className="setup-dialog-social-item">
              <XIcon
                className="h-4 w-4 shrink-0 [&_path]:fill-current text-foreground/70"
                aria-hidden
              />
              <input
                placeholder="https://x.com/username"
                value={xUrl}
                onChange={(e) => setXUrl(e.target.value)}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                {...ignoreAttrs}
                className="setup-dialog-tile-input"
              />
            </div>
            <div className="setup-dialog-social-item">
              <InstagramIcon className="h-4 w-4 shrink-0" aria-hidden />
              <input
                placeholder="https://www.instagram.com/username/"
                value={instagramUrl}
                onChange={(e) => setInstagramUrl(e.target.value)}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                {...ignoreAttrs}
                className="setup-dialog-tile-input"
              />
            </div>
            <div className="setup-dialog-social-item">
              <Linkedin className="h-4 w-4 shrink-0" aria-hidden />
              <input
                placeholder="https://www.linkedin.com/in/username/"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                {...ignoreAttrs}
                className="setup-dialog-tile-input"
              />
            </div>
          </div>
        </div>

        {name.length > 0 && (
          <div className="setup-dialog-submit-cell">
            <Button
              type="submit"
              disabled={!name.trim() || closing}
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
