import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLASSES_REPERE, DUREE_REPERE_MS, poserRepere } from "@/components/planning/repere-visuel";

/**
 * **Le repère qui montre une ligne qu'on vient de déplacer, ou qu'on vient de retrouver.**
 *
 * Il a été extrait pour deux appelants — l'arrivée sur une séance (`AllerALAncre`) et la bascule
 * Cours/Option, qui déplaçait la ligne qu'on venait de régler. La bascule a été retirée le soir
 * même (« enlève le slider et mets 2 boutons »), et il ne reste que l'arrivée. Ces tests, eux,
 * restent le seul endroit où la mécanique du repère est **éprouvée** : le code inline de l'ancre ne
 * l'avait jamais été, et c'est lui qui s'est trouvé à défiler « vers l'endroit où la ligne était ».
 *
 * La suite tourne en `environment: "node"` : on fournit donc un élément et une horloge de pacotille,
 * ce qui suffit — la fonction ne fait rien d'autre que défiler, poser des classes et les retirer.
 */

type ElementFeint = {
  classes: Set<string>;
  defilements: ScrollIntoViewOptions[];
  classList: { add: (...c: string[]) => void; remove: (...c: string[]) => void };
  scrollIntoView: (o: ScrollIntoViewOptions) => void;
};

function elementFeint(): ElementFeint {
  const classes = new Set<string>();
  const defilements: ScrollIntoViewOptions[] = [];
  return {
    classes,
    defilements,
    classList: {
      add: (...c: string[]) => c.forEach((x) => classes.add(x)),
      remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
    },
    scrollIntoView: (o: ScrollIntoViewOptions) => defilements.push(o),
  };
}

/** Les frames en attente, pour les déclencher à la main — un navigateur ne les rend jamais ici. */
let frames: Array<(() => void) | null>;

beforeEach(() => {
  frames = [];
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => frames.push(f));
  vi.stubGlobal("cancelAnimationFrame", (i: number) => {
    frames[i - 1] = null;
  });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const jouerLesFrames = () => frames.forEach((f) => f?.());

describe("poserRepere — ce qu'il fait, et quand", () => {
  it("ne fait rien avant la frame suivante", () => {
    // C'est ce qu'il faut à une **arrivée** sur la page : affiches, polices et grille rendue dans un
    // `<Suspense>` n'ont pas fini de se poser, donc la bonne position n'est pas encore connue.
    const el = elementFeint();
    poserRepere(el as unknown as HTMLElement, "start");
    expect(el.defilements).toEqual([]);
    expect(el.classes.size).toBe(0);
    jouerLesFrames();
    expect(el.defilements).toEqual([{ block: "start" }]);
    expect([...el.classes]).toEqual([...CLASSES_REPERE]);
  });

  it("retire le trait de lui-même, après le temps qu'il faut pour le trouver", () => {
    const el = elementFeint();
    poserRepere(el as unknown as HTMLElement, "start");
    jouerLesFrames();
    vi.advanceTimersByTime(DUREE_REPERE_MS - 1);
    expect(el.classes.size).toBe(CLASSES_REPERE.length);
    vi.advanceTimersByTime(1);
    expect(el.classes.size).toBe(0);
  });

  it("annulé, il n'écrit rien et ne laisse rien derrière", () => {
    const el = elementFeint();
    const annuler = poserRepere(el as unknown as HTMLElement, "start");
    annuler();
    jouerLesFrames();
    expect(el.defilements).toEqual([]);
    expect(el.classes.size).toBe(0);
    // Et le minuteur ne vient pas frapper plus tard sur une ligne qui n'est plus celle-là.
    vi.advanceTimersByTime(DUREE_REPERE_MS * 2);
    expect(el.classes.size).toBe(0);
  });

  it("annulé après avoir posé le trait, il le retire", () => {
    const el = elementFeint();
    const annuler = poserRepere(el as unknown as HTMLElement, "start");
    jouerLesFrames();
    expect(el.classes.size).toBe(CLASSES_REPERE.length);
    annuler();
    expect(el.classes.size).toBe(0);
  });

  it("peut souligner sans défiler", () => {
    const el = elementFeint();
    poserRepere(el as unknown as HTMLElement, null);
    jouerLesFrames();
    expect(el.defilements).toEqual([]);
    expect([...el.classes]).toEqual([...CLASSES_REPERE]);
  });
});
