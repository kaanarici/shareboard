import { X as XIcon } from "@/components/ui/svgs/x";
import { InstagramIcon } from "@/components/ui/svgs/instagramIcon";
import { Linkedin } from "@/components/ui/svgs/linkedin";
import type { ProfileDraft } from "@/lib/store";

const ignoreAttrs = {
  autoComplete: "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-bwignore": true,
  "data-protonpass-ignore": true,
} as const;

const SOCIAL_FIELDS = [
  {
    key: "xUrl",
    placeholder: "x.com/username",
    icon: <XIcon className="h-4 w-4 shrink-0 [&_path]:fill-current text-foreground/70" aria-hidden />,
  },
  {
    key: "instagramUrl",
    placeholder: "instagram.com/username",
    icon: <InstagramIcon className="h-4 w-4 shrink-0" aria-hidden />,
  },
  {
    key: "linkedinUrl",
    placeholder: "linkedin.com/in/username",
    icon: <Linkedin className="h-4 w-4 shrink-0" aria-hidden />,
  },
] as const;

export function ProfileFields({
  value,
  onChange,
  nameId,
  nameAutoFocus,
  framed,
}: {
  value: ProfileDraft;
  onChange: (next: ProfileDraft) => void;
  nameId?: string;
  nameAutoFocus?: boolean;
  framed?: boolean;
}) {
  const nameClass = framed
    ? "setup-dialog-card setup-dialog-tile setup-dialog-tile--name"
    : "setup-dialog-tile";
  const socialsClass = framed
    ? "setup-dialog-card setup-dialog-tile setup-dialog-tile--socials"
    : "setup-dialog-tile";
  return (
    <>
      <div className={nameClass}>
        <span className="setup-dialog-tile-label">Display name</span>
        <input
          id={nameId}
          placeholder="Your name"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          autoFocus={nameAutoFocus}
          enterKeyHint="next"
          autoCapitalize="words"
          {...ignoreAttrs}
          className="setup-dialog-tile-input"
        />
      </div>

      <div className={socialsClass}>
        <span className="setup-dialog-tile-label">
          Social links
          <span className="setup-dialog-tile-label-muted">(optional)</span>
        </span>
        <div className="setup-dialog-social-list">
          {SOCIAL_FIELDS.map((field) => (
            <div key={field.key} className="setup-dialog-social-item">
              {field.icon}
              <input
                placeholder={field.placeholder}
                value={value[field.key]}
                onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                {...ignoreAttrs}
                className="setup-dialog-tile-input"
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
