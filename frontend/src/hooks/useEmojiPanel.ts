import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import emojiDataRaw from 'emoji-data/vendor/emoji-data/emoji.json';
import { parse as parseTwemoji } from 'twemoji-parser';

const RECENT_EMOJI_KEY = 'tg_recent_emoji';

const ASSET_VERSION =
  (import.meta.env.VITE_ASSET_VERSION as string | undefined) ||
  (__APP_VERSION__ || '1');
const EMOJI_CACHE_NAME = `emoji-assets-${ASSET_VERSION}`;
const versionedEmojiUrl = (path: string): string => `/emoji/${path}?v=${ASSET_VERSION}`;
const EMOJI_PARSE_OPTIONS = { base: '/emoji/', ext: '.png' };

const applyEmojiVersion = (url: string): string => {
  return url.includes('?') ? url : `${url}?v=${ASSET_VERSION}`;
};

const unifiedToChar = (unified: string): string => {
  return unified
    .split('-')
    .map((code) => String.fromCodePoint(parseInt(code, 16)))
    .join('');
};

const transliterate = (value: string): string => {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e',
    ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
    ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ы: 'y', э: 'e', ю: 'yu', я: 'ya',
  };
  return value
    .split('')
    .map((ch) => {
      const lower = ch.toLowerCase();
      const repl = map[lower];
      if (!repl) return ch;
      return ch === lower ? repl : repl.toUpperCase();
    })
    .join('');
};

const resolveEmojiImageUrl = (char: string, unified: string, imageName?: string): string => {
  if (imageName) return versionedEmojiUrl(imageName);
  const parsed = parseTwemoji(char, EMOJI_PARSE_OPTIONS);
  if (parsed.length > 0 && parsed[0].url) return applyEmojiVersion(parsed[0].url);
  return versionedEmojiUrl(`${unified.toLowerCase()}.png`);
};

export type EmojiEntry = {
  key: string;
  char: string;
  imageUrl: string | null;
  name: string;
  categoryKey: string;
  sortOrder: number;
  aliases: string[];
};

type RawEmoji = {
  unified: string;
  short_name: string;
  short_names?: string[];
  image: string;
  category: string;
  sort_order?: number;
  name?: string;
};

type EmojiDataRecord = {
  unified: string;
  short_name: string;
  short_names?: string[];
  name?: string;
  image?: string;
  variations?: string[];
};

const EMOJI_ICONS = {
  recent: '❤️', smileys: '😀', people: '👍', animals: '🐾',
  food: '🍕', activities: '🎉', travel: '✈️', objects: '💡',
  symbols: '♾️', flags: '🏳️',
} satisfies Record<string, string>;

const EMOJI_CATEGORY_ORDER = [
  { key: 'recent', source: 'recent', label: 'Частые', icon: EMOJI_ICONS.recent },
  { key: 'smileys', source: 'Smileys & Emotion', label: 'Смайлы', icon: EMOJI_ICONS.smileys },
  { key: 'people', source: 'People & Body', label: 'Люди и жесты', icon: EMOJI_ICONS.people },
  { key: 'animals', source: 'Animals & Nature', label: 'Животные', icon: EMOJI_ICONS.animals },
  { key: 'food', source: 'Food & Drink', label: 'Еда', icon: EMOJI_ICONS.food },
  { key: 'activities', source: 'Activities', label: 'Активности', icon: EMOJI_ICONS.activities },
  { key: 'travel', source: 'Travel & Places', label: 'Путешествия', icon: EMOJI_ICONS.travel },
  { key: 'objects', source: 'Objects', label: 'Объекты', icon: EMOJI_ICONS.objects },
  { key: 'symbols', source: 'Symbols', label: 'Символы', icon: EMOJI_ICONS.symbols },
  { key: 'flags', source: 'Flags', label: 'Флаги', icon: EMOJI_ICONS.flags },
];

const EXTRA_EMOJI_ALIASES: Record<string, string[]> = {
  underage: ['18+', '18 plus', 'adult only', 'nsfw', 'restricted'],
  heart: ['heart', 'love'],
  heavy_heart_exclamation: ['broken heart', 'heavy heart'],
  thumbs_up: ['like', 'ok', 'да', 'согласен'],
  thumbs_down: ['dislike', 'нет', 'не согласен'],
  tada: ['party', 'праздник', 'вечеринка', 'конфетти'],
  grinning: ['smile', 'улыбка'],
  slightly_smiling_face: ['ok face', 'нейтрально', 'слегка улыбка'],
  frowning_face: ['sad', 'грусть', 'печаль'],
  smiling_face_with_3_hearts: ['люблю', 'обнимаю'],
};

const readStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeStorage = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
};

const cleanupOldEmojiCaches = async () => {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('emoji-assets-') && key !== EMOJI_CACHE_NAME)
        .map((key) => caches.delete(key)),
    );
  } catch {
    // ignore
  }
};

const fetchEmojiJson = async (): Promise<RawEmoji[]> => {
  const url = versionedEmojiUrl('emoji_pretty.json');
  const canCache = typeof window !== 'undefined' && 'caches' in window;
  const cache = canCache ? await caches.open(EMOJI_CACHE_NAME) : null;

  if (cache) {
    const cached = await cache.match(url);
    if (cached) {
      try {
        return (await cached.json()) as RawEmoji[];
      } catch {
        // fall back to network
      }
    }
  }

  const response = await fetch(url, { cache: cache ? 'no-cache' : 'force-cache' });
  if (!response.ok) throw new Error('Не удалось загрузить эмодзи');
  if (cache) {
    try {
      await cache.put(url, response.clone());
    } catch {
      // ignore
    }
  }
  return (await response.json()) as RawEmoji[];
};

export function useEmojiPanel() {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState('smileys');
  const [recentEmoji, setRecentEmoji] = useState<string[]>(
    readStorage<string[]>(RECENT_EMOJI_KEY, []),
  );
  const [emojiData, setEmojiData] = useState<EmojiEntry[]>([]);
  const [emojiLoading, setEmojiLoading] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');

  const emojiCategoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const emojiCategoryScrollRef = useRef<HTMLDivElement | null>(null);
  const emojiCategoryDragRef = useRef<{
    active: boolean;
    startX: number;
    scrollLeft: number;
  }>({ active: false, startX: 0, scrollLeft: 0 });

  // Save recent emoji to localStorage
  useEffect(() => {
    writeStorage(RECENT_EMOJI_KEY, recentEmoji);
  }, [recentEmoji]);

  // Drag handling for category tabs
  const handleCategoryMouseDown = useCallback((event: React.MouseEvent) => {
    const target = emojiCategoryScrollRef.current;
    if (!target) return;
    emojiCategoryDragRef.current.active = true;
    emojiCategoryDragRef.current.startX = event.clientX;
    emojiCategoryDragRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const handleCategoryMouseMove = useCallback((event: MouseEvent) => {
    if (!emojiCategoryDragRef.current.active) return;
    const target = emojiCategoryScrollRef.current;
    if (!target) return;
    event.preventDefault();
    const delta = event.clientX - emojiCategoryDragRef.current.startX;
    target.scrollLeft = emojiCategoryDragRef.current.scrollLeft - delta;
  }, []);

  const handleCategoryMouseUp = useCallback(() => {
    emojiCategoryDragRef.current.active = false;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleCategoryMouseMove);
    window.addEventListener('mouseup', handleCategoryMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleCategoryMouseMove);
      window.removeEventListener('mouseup', handleCategoryMouseUp);
    };
  }, [handleCategoryMouseMove, handleCategoryMouseUp]);

  const handleEmojiCategoryClick = useCallback((key: string) => {
    setEmojiCategory(key);
    const target = emojiCategoryRefs.current[key];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Load emoji data
  useEffect(() => {
    let cancelled = false;
    void cleanupOldEmojiCaches();

    const loadEmoji = async () => {
      try {
        setEmojiLoading(true);
        const raw = await fetchEmojiJson();
        const emojiDataList = emojiDataRaw as EmojiDataRecord[];
        const emojiByUnified = new Map<string, EmojiDataRecord>();
        const emojiByShortName = new Map<string, EmojiDataRecord>();
        emojiDataList.forEach((record) => {
          emojiByUnified.set(record.unified, record);
          emojiByShortName.set(record.short_name, record);
        });
        const mapped = raw
          .filter((item) => item.category !== 'Component' && item.unified)
          .map<EmojiEntry>((item) => {
            const match = emojiByUnified.get(item.unified) || emojiByShortName.get(item.short_name);
            const categoryKey =
              EMOJI_CATEGORY_ORDER.find((cat) => cat.source === item.category)?.key ||
              item.category;
            const aliasSet = new Set<string>();
            const addAliases = (values?: string[]) => {
              values?.forEach((value) => { if (value) aliasSet.add(value); });
            };
            aliasSet.add(item.short_name);
            addAliases(item.short_names);
            if (match) {
              aliasSet.add(match.short_name);
              addAliases(match.short_names);
            }
            addAliases(EXTRA_EMOJI_ALIASES[item.short_name]);
            if (match) addAliases(EXTRA_EMOJI_ALIASES[match.short_name]);
            const char = unifiedToChar(item.unified);
            const imageName = item.image || match?.image;
            return {
              key: `${item.short_name}-${item.unified}`,
              char,
              imageUrl: resolveEmojiImageUrl(char, item.unified, imageName),
              name: item.name || match?.name || item.short_name,
              categoryKey,
              sortOrder: Number(item.sort_order || 0),
              aliases: Array.from(aliasSet),
            };
          });
        if (!cancelled) setEmojiData(mapped);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setEmojiLoading(false);
      }
    };

    void loadEmoji();
    return () => { cancelled = true; };
  }, []);

  const emojiMap = useMemo(() => {
    const map = new Map<string, EmojiEntry>();
    emojiData.forEach((item) => map.set(item.char, item));
    return map;
  }, [emojiData]);

  const emojiGroups = useMemo(() => {
    const groups: Record<string, EmojiEntry[]> = {};
    EMOJI_CATEGORY_ORDER.forEach((category) => {
      if (category.key !== 'recent') groups[category.key] = [];
    });
    emojiData.forEach((item) => {
      if (!groups[item.categoryKey]) groups[item.categoryKey] = [];
      groups[item.categoryKey].push(item);
    });
    Object.values(groups).forEach((items) =>
      items.sort((a, b) => a.sortOrder - b.sortOrder),
    );
    return groups;
  }, [emojiData]);

  const emojiCategories = useMemo(() => {
    const recentItems: EmojiEntry[] = recentEmoji.map((char) => {
      const found = emojiMap.get(char);
      if (found) return found;
      return {
        key: char, char, imageUrl: null, name: char,
        categoryKey: 'recent', sortOrder: 0, aliases: [],
      };
    });

    const categories = EMOJI_CATEGORY_ORDER.filter((c) => c.key !== 'recent').map(
      (c) => ({
        key: c.key, label: c.label, icon: c.icon,
        emojis: emojiGroups[c.key] || [],
      }),
    );

    return [
      {
        key: 'recent',
        label: EMOJI_CATEGORY_ORDER[0].label,
        icon: EMOJI_CATEGORY_ORDER[0].icon,
        emojis: recentItems,
      },
      ...categories,
    ];
  }, [recentEmoji, emojiGroups, emojiMap]);

  const parseEmojiMatches = useCallback((text: string) => {
    return parseTwemoji(text, EMOJI_PARSE_OPTIONS);
  }, []);

  const buildEmojiParts = useCallback(
    (text: string) => {
      const parts: Array<
        | { type: 'text'; value: string }
        | { type: 'emoji'; value: string; url: string; name: string }
      > = [];
      const matches = parseEmojiMatches(text);
      let lastIndex = 0;
      matches.forEach((match) => {
        const [start, end] = match.indices;
        if (start > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, start) });
        const emoji = emojiMap.get(match.text);
        const imageUrl = emoji?.imageUrl || (match.url ? applyEmojiVersion(match.url) : null);
        if (imageUrl) {
          parts.push({ type: 'emoji', value: match.text, url: imageUrl, name: emoji?.name || match.text });
        } else {
          parts.push({ type: 'text', value: match.text });
        }
        lastIndex = end;
      });
      if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) });
      return parts;
    },
    [emojiMap, parseEmojiMatches],
  );

  const extractEmojisFromText = useCallback(
    (text: string): string[] => {
      if (!text || emojiMap.size === 0) return [];
      return parseEmojiMatches(text).map((item) => item.text);
    },
    [emojiMap, parseEmojiMatches],
  );

  const isEmojiOnlyText = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const parts = parseEmojiMatches(trimmed).map((item) => item.text);
      return parts.length > 0 && parts.join('') === trimmed;
    },
    [parseEmojiMatches],
  );

  const addRecentEmojis = useCallback((chars: string[]) => {
    if (chars.length === 0) return;
    const unique = chars.filter((item, index) => chars.indexOf(item) === index);
    setRecentEmoji((prev) => {
      const next = [...unique, ...prev.filter((item) => !unique.includes(item))];
      return next.slice(0, 24);
    });
  }, []);

  const emojiSearchValue = emojiSearch.trim().toLowerCase();
  const emojiSearchAlt = transliterate(emojiSearchValue);

  const currentEmojiList = useMemo(() => {
    if (emojiSearchValue) {
      return emojiData.filter((emoji) => {
        const baseHaystack = [emoji.name, emoji.char, emoji.categoryKey, ...emoji.aliases]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        const haystack = `${baseHaystack} ${transliterate(baseHaystack)}`;
        return (
          haystack.includes(emojiSearchValue) ||
          (emojiSearchAlt && haystack.includes(emojiSearchAlt))
        );
      });
    }
    return emojiCategories.find((cat) => cat.key === emojiCategory)?.emojis || [];
  }, [emojiSearchValue, emojiSearchAlt, emojiData, emojiCategories, emojiCategory]);

  return {
    emojiOpen,
    setEmojiOpen,
    emojiCategory,
    emojiSearch,
    setEmojiSearch,
    emojiSearchValue,
    emojiLoading,
    emojiCategories,
    currentEmojiList,
    emojiMap,
    emojiCategoryRefs,
    emojiCategoryScrollRef,
    handleCategoryMouseDown,
    handleCategoryMouseUp,
    handleEmojiCategoryClick,
    buildEmojiParts,
    extractEmojisFromText,
    isEmojiOnlyText,
    addRecentEmojis,
    parseEmojiMatches,
  };
}
