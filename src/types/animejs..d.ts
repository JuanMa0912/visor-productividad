type AnimeTargets = string | Element | Element[] | NodeListOf<Element>;

type AnimeParams = {
  targets?: AnimeTargets;
  [key: string]: unknown;
};

type AnimeInstance = ((params: AnimeParams) => void) & {
  pause?: () => void;
  remove?: (targets: AnimeTargets) => void;
};

interface Window {
  anime?: AnimeInstance;
}
