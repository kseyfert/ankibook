#!/usr/bin/env python3
"""
Генерирует частотную таблицу для vocabmine.

Запускается ВРУЧНУЮ, результат коммитится в репозиторий:

    pip install wordfreq
    python tools/build-freq.py

Почему офлайн, а не в рантайме:
  * wordfreq существует только на Python, а проект на TypeScript;
  * результат детерминирован и версионируется вместе с кодом — иначе
    обновление библиотеки молча сдвинет пороги отбора слов;
  * загрузка готового файла быстрее любого пересчёта.

Формат вывода: одна строка на значение zipf, слова через пробел.
    3.5<TAB>ordeal humility gaunt ...
Группировка нужна, чтобы не повторять число 100 000 раз.
"""

import sys
from collections import defaultdict
from pathlib import Path

try:
    from wordfreq import top_n_list, zipf_frequency
except ImportError:
    sys.exit("Нужен wordfreq:  pip install wordfreq")

LANG = "en"
MIN_ZIPF = 2.0          # ниже — статистически неотличимый шум
OUT = Path(__file__).resolve().parent.parent / "data" / "freq-en.txt"

# только словоподобное: буквы, внутри допустимы апостроф и дефис
import re
WORDLIKE = re.compile(r"^[a-z][a-z'-]*$")


def main() -> None:
    buckets: dict[float, list[str]] = defaultdict(list)
    total = 0

    for word in top_n_list(LANG, 500_000):
        if not WORDLIKE.match(word):
            continue
        z = round(zipf_frequency(word, LANG), 1)
        if z < MIN_ZIPF:
            continue
        buckets[z].append(word)
        total += 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        f.write(f"# vocabmine frequency table | lang={LANG} min_zipf={MIN_ZIPF} words={total}\n")
        for z in sorted(buckets, reverse=True):
            if not buckets[z]:      # диапазон мог опустеть после фильтра WORDLIKE
                continue
            f.write(f"{z:.1f}\t{' '.join(sorted(buckets[z]))}\n")

    size_kb = OUT.stat().st_size / 1024
    print(f"{OUT}: {total} слов, {len(buckets)} диапазонов, {size_kb:.0f} КБ")


if __name__ == "__main__":
    main()