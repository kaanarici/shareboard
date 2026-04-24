
import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isPlausibleOpenaiApiKey, sanitizeOpenaiApiKeyInput } from "@/lib/openai-api-key";
import { setApiKey, setName, setProfile } from "@/lib/store";
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
  const [key, setKeyValue] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [closing, setClosing] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || closing) return;
    setName(name.trim());
    setApiKey(key);
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
          <h2 className="font-heading text-lg leading-none font-medium">
            Welcome to Shareboard
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            A canvas for links, notes, and images. Arrange on the grid, share one link,
            or use Summarize with your own OpenAI key.
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
                {...ignoreAttrs}
                className="setup-dialog-tile-input"
              />
            </div>
          </div>
        </div>

        <div className="setup-dialog-card setup-dialog-tile setup-dialog-tile--apikey">
          <span className="setup-dialog-tile-label">
            OpenAI API key
            <span className="setup-dialog-tile-label-muted">(optional, for Summarize)</span>
          </span>
          <div className="setup-dialog-apikey-row">
            <input
              type="text"
              placeholder="sk-..."
              value={key}
              onChange={(e) => setKeyValue(sanitizeOpenaiApiKeyInput(e.target.value))}
              {...ignoreAttrs}
              className="setup-dialog-tile-input setup-dialog-tile-input--masked"
            />
            {isPlausibleOpenaiApiKey(key) && (
              <span
                className="setup-dialog-apikey-ok"
                title="Key format looks good"
                aria-label="Key format looks good"
              >
                <Check strokeWidth={2.5} aria-hidden />
              </span>
            )}
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
