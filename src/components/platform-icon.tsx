import type { Platform } from "@/lib/types";
import { X } from "@/components/ui/svgs/x";
import { Linkedin } from "@/components/ui/svgs/linkedin";
import { InstagramIcon } from "@/components/ui/svgs/instagramIcon";
import { Youtube } from "@/components/ui/svgs/youtube";
import { Reddit } from "@/components/ui/svgs/reddit";
import { Threads } from "@/components/ui/svgs/threads";
import { FacebookIcon } from "@/components/ui/svgs/facebookIcon";
import { TiktokIconLight } from "@/components/ui/svgs/tiktokIconLight";
import { Globe } from "lucide-react";

const ICONS: Record<Platform, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  twitter: X,
  linkedin: Linkedin,
  instagram: InstagramIcon,
  youtube: Youtube,
  reddit: Reddit,
  threads: Threads,
  facebook: FacebookIcon,
  tiktok: TiktokIconLight,
  website: Globe,
};

export function PlatformIcon({
  platform,
  className = "h-4 w-4",
}: {
  platform: Platform;
  className?: string;
}) {
  const Icon = ICONS[platform];
  return <Icon className={className} />;
}
