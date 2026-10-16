/**
 * The marketing page's only media: six illustrative event photos and a short
 * loop cut from each. None of it is customer footage.
 *
 * The loops are generated from the stills, not filmed: a six-second seamless
 * handheld drift on a tighter crop, 640x480 H.264 at about 125 KB, with the
 * first frame saved as the poster. To rebuild one (wedding shown):
 *
 *   ffmpeg -loop 1 -framerate 24 -t 6 -i public/images/sample-events/wedding-reception.png \
 *     -vf "crop=960:720:230:80,scale=2560:1920:flags=lanczos,zoompan=z='1.10+0.045*sin(2*PI*on/144)':x='iw/2-(iw/zoom/2)+iw*0.012*sin(2*PI*on/72+0.4)+iw*0.0018*sin(2*PI*on/20.571)':y='ih/2-(ih/zoom/2)+ih*0.010*sin(2*PI*on/144+0.68)':d=1:s=640x480:fps=24,format=yuv420p" \
 *     -frames:v 144 -c:v libx264 -preset slow -crf 29 -profile:v high -movflags +faststart -an public/media/home/wedding.mp4
 *
 * Real event footage, once there is some with permission to use it, replaces
 * these by changing the paths here and nothing else.
 */

export type Moment = {
  id: string;
  /** What the photo shows, for edge print and alt text. */
  label: string;
  still: string;
  loop: string;
  poster: string;
};

export const MOMENTS = {
  wedding: {
    id: "wedding",
    label: "Wedding",
    still: "/images/sample-events/wedding-reception.png",
    loop: "/media/home/wedding.mp4",
    poster: "/media/home/wedding.jpg",
  },
  birthday: {
    id: "birthday",
    label: "Birthday",
    still: "/images/sample-events/birthday-party.png",
    loop: "/media/home/birthday.mp4",
    poster: "/media/home/birthday.jpg",
  },
  company: {
    id: "company",
    label: "Company party",
    still: "/images/sample-events/company-party.png",
    loop: "/media/home/company.mp4",
    poster: "/media/home/company.jpg",
  },
  reunion: {
    id: "reunion",
    label: "Reunion",
    still: "/images/sample-events/family-reunion.png",
    loop: "/media/home/reunion.mp4",
    poster: "/media/home/reunion.jpg",
  },
  shower: {
    id: "shower",
    label: "Baby shower",
    still: "/images/sample-events/baby-shower.png",
    loop: "/media/home/shower.mp4",
    poster: "/media/home/shower.jpg",
  },
  graduation: {
    id: "graduation",
    label: "Graduation",
    still: "/images/sample-events/graduation.png",
    loop: "/media/home/graduation.mp4",
    poster: "/media/home/graduation.jpg",
  },
} satisfies Record<string, Moment>;

/** The loops are exactly this long, so the duration chip tells the truth. */
export const LOOP_SECONDS = 6;

/**
 * The demo gallery's address. It is the real home page, so anyone who scans a
 * QR drawn from it lands somewhere that works rather than on a made-up event.
 */
export const DEMO_URL = "https://klik.kreativvantage.com";
