/*
 * THESIS: the home page is one camera roll. Every section is a strip of film
 * frames, and volt is the grease pencil circling the keepers. It refuses the
 * category's hero-plus-icon-grid: the product is shown working, frame by frame.
 * OWN-WORLD: near-black canvas, film rebate a shade lighter, sprocket holes,
 * edge print in dim volt, Fraunces display, volt grease-pencil marks, one cream
 * light table. Photos and short loops only inside frames.
 * STORY: a host sees guests' phones filling one album, sees how (scan, snap,
 * lands), sees they stay in control, picks a plan, trusts the consent.
 * FIRST VIEWPORT: centred headline and Create button above a draggable 3D reel
 * of photo and video frames drifting on a cylinder, one keeper circled.
 * FORM: The Contact Sheet, first of three dealt structures; seed 4afca374.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, DESIGN.md, and every shipping raster carrying its
 * provenance.
 */
import { Nav } from "@/components/marketing/nav";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { OrganizerFeatures } from "@/components/marketing/organizer-features";
import { Pricing } from "@/components/marketing/pricing";
import { UseCases } from "@/components/marketing/use-cases";
import { ConsentNote } from "@/components/marketing/consent-note";
import { FinalCta } from "@/components/marketing/final-cta";
import { Footer } from "@/components/marketing/footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <UseCases />
        <OrganizerFeatures />
        <Pricing />
        <ConsentNote />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
