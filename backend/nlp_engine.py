"""
Standup NLP Engine
==================
Pure Python summarizer using TF-IDF + TextRank graph scoring.
Zero external data files. No LLMs. No NLTK corpus downloads.

Pipeline:
  1. Sentence splitting (regex-based)
  2. TF-IDF vectorization (sklearn, no corpus needed)
  3. TextRank scoring via cosine similarity graph
  4. Extractive summary (top-N sentences in original order)
  5. Action item detection (regex + heuristics)
  6. Decision detection (regex + heuristics)
  7. Topic clustering (TF-IDF top terms per speaker segment)
  8. Keyword extraction (TF-IDF global top terms)
  9. Stats: talk-time per speaker, sentiment polarity (lexicon-based)
"""

import re
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
import numpy as np

# ---------------------------------------------------------------------------
# Stop words (built-in, no download needed)
# ---------------------------------------------------------------------------
STOP_WORDS = frozenset("""
a about above after again against all am an and any are aren't as at be because been
before being below between both but by can't cannot could couldn't did didn't do does
doesn't doing don't down during each few for from further get got had hadn't has hasn't
have haven't having he he'd he'll he's her here here's hers herself him himself his
how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most
mustn't my myself no nor not of off on once only or other ought our ours ourselves out
over own same shan't she she'd she'll she's should shouldn't so some such than that
that's the their theirs them themselves then there there's these they they'd they'll
they're they've this those through to too under until up very was wasn't we we'd we'll
we're we've were weren't what what's when when's where where's which while who who's
whom why why's will with won't would wouldn't you you'd you'll you're you've your yours
yourself yourselves just also even like really think know going say said okay well right
yeah yes no oh um uh hmm ah got let make see look come go need want use
""".split())

# ---------------------------------------------------------------------------
# Sentiment lexicon (AFINN-style, compact built-in)
# ---------------------------------------------------------------------------
POSITIVE_WORDS = frozenset("""
good great excellent amazing wonderful fantastic awesome outstanding superb perfect
brilliant success successful achieve accomplished completed approved confirmed done
agree agreed positive progress advance forward improvement improved better best
efficient effective productive happy pleased excited enthusiastic confident strong
""".split())

NEGATIVE_WORDS = frozenset("""
bad poor terrible awful horrible wrong fail failed failure error problem issue concern
risk delay delayed blocking blocked stuck difficult hard challenge challenging unclear
confused concern worried worried uncertain incomplete missing broken bug crash
slow expensive costly delay behind schedule overdue reject rejected cancel cancelled
""".split())

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------
ACTION_PATTERNS = [
    re.compile(r'\b(will|shall|going\s+to|needs?\s+to|has\s+to|have\s+to|must|should)\b', re.I),
    re.compile(r'\b(action\s+item|todo|to\s+do|task|assigned\s+to|responsible\s+for)\b', re.I),
    re.compile(r'\b(follow[\s-]?up|next\s+step|deliverable|take\s+care\s+of)\b', re.I),
    re.compile(r'\b(i\'ll|i\s+will|we\'ll|we\s+will)\b', re.I),
    re.compile(r'\b(by\s+(monday|tuesday|wednesday|thursday|friday|tomorrow|next\s+week|eod|cob))\b', re.I),
]

DECISION_PATTERNS = [
    re.compile(r'\b(decided|agreed|approved|confirmed|resolved|concluded|chosen|selected|finalized)\b', re.I),
    re.compile(r'\b(we\s+(will|are\s+going\s+to|have\s+decided|agreed|chose))\b', re.I),
    re.compile(r'\b(the\s+(team|group|everyone|we|company)\s+(agreed|decided|confirmed|approved))\b', re.I),
    re.compile(r'\b(let\'s\s+go\s+with|moving\s+forward\s+with|sticking\s+with|going\s+with)\b', re.I),
    re.compile(r'\b(it\s+is\s+(decided|approved|confirmed|agreed))\b', re.I),
]

QUESTION_PATTERNS = [
    re.compile(r'\b(who|what|when|where|why|how|which|can\s+we|should\s+we|do\s+we|is\s+it)\b.{5,}', re.I),
]

SENTENCE_SPLIT = re.compile(r'(?<=[.!?])\s+(?=[A-Z"])|(?<=\n)(?=[A-Z"])')


# ---------------------------------------------------------------------------
# Sentence tokenizer
# ---------------------------------------------------------------------------
def split_sentences(text: str) -> List[str]:
    """Split text into sentences without NLTK."""
    # Normalize
    text = re.sub(r'[ \t]+', ' ', text.strip())
    text = re.sub(r'\n{3,}', '\n\n', text)

    # Split on sentence-ending punctuation
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z"\'])|(?<=[.!?])\s*\n', text)
    result = []
    for p in parts:
        p = p.strip()
        if len(p) > 8:
            result.append(p)
    return result


def tokenize_words(text: str) -> List[str]:
    """Tokenize and filter stop words."""
    return [w for w in re.findall(r'[a-z]+', text.lower())
            if w not in STOP_WORDS and len(w) > 2]


# ---------------------------------------------------------------------------
# TF-IDF + TextRank
# ---------------------------------------------------------------------------
def compute_tfidf_matrix(sentences: List[str]) -> Tuple[np.ndarray, List[str]]:
    """Compute TF-IDF matrix for sentences."""
    # Build vocabulary
    tokenized = [tokenize_words(s) for s in sentences]
    vocab_set: set = set()
    for words in tokenized:
        vocab_set.update(words)
    vocab = sorted(vocab_set)
    word_idx = {w: i for i, w in enumerate(vocab)}

    N = len(sentences)
    V = len(vocab)
    if N == 0 or V == 0:
        return np.zeros((N, V)), vocab

    # TF
    tf_matrix = np.zeros((N, V))
    for i, words in enumerate(tokenized):
        if not words:
            continue
        counts = Counter(words)
        for w, c in counts.items():
            if w in word_idx:
                tf_matrix[i, word_idx[w]] = c / len(words)

    # IDF
    df = (tf_matrix > 0).sum(axis=0)
    idf = np.log((N + 1) / (df + 1)) + 1.0  # smoothed

    tfidf = tf_matrix * idf
    return tfidf, vocab


def cosine_similarity_matrix(matrix: np.ndarray) -> np.ndarray:
    """Compute pairwise cosine similarity."""
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1e-10
    normed = matrix / norms
    return normed @ normed.T


def textrank_scores(sim_matrix: np.ndarray, damping: float = 0.85, iterations: int = 30) -> np.ndarray:
    """TextRank power iteration."""
    N = sim_matrix.shape[0]
    if N == 0:
        return np.array([])
    if N == 1:
        return np.array([1.0])

    # Row-normalize (avoid div by zero)
    row_sums = sim_matrix.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1e-10
    trans = (sim_matrix / row_sums).T

    scores = np.ones(N) / N
    for _ in range(iterations):
        scores = (1 - damping) / N + damping * trans @ scores

    # Normalize to [0,1]
    mn, mx = scores.min(), scores.max()
    if mx > mn:
        scores = (scores - mn) / (mx - mn)
    return scores


# ---------------------------------------------------------------------------
# Main summarizer
# ---------------------------------------------------------------------------
@dataclass
class TranscriptEntry:
    speaker: str
    text: str
    timestamp: float = 0.0  # seconds from start


@dataclass
class MeetingSummary:
    title: str
    duration_minutes: float
    participant_count: int
    summary_sentences: List[str]
    action_items: List[Dict]
    decisions: List[str]
    key_topics: List[str]
    speaker_stats: Dict[str, Dict]
    sentiment: str        # "positive" | "neutral" | "mixed" | "negative"
    sentiment_score: float  # -1.0 to 1.0
    word_cloud_terms: List[Dict]  # [{word, weight}]
    questions_raised: List[str]
    meeting_highlights: List[str]


def summarize_meeting(
    transcript: List[TranscriptEntry],
    duration_minutes: float = 0.0,
    title: str = "Meeting",
    num_summary_sentences: int = 6,
) -> MeetingSummary:
    """
    Full meeting summarization pipeline.
    Input: list of TranscriptEntry (speaker + text + optional timestamp)
    Output: MeetingSummary dataclass
    """
    participants = list(dict.fromkeys(e.speaker for e in transcript if e.speaker))
    full_text = " ".join(e.text for e in transcript)

    # --- Sentence splitting ---
    all_sentences = split_sentences(full_text)
    if not all_sentences:
        all_sentences = [full_text] if full_text.strip() else []

    # --- TF-IDF + TextRank for summary ---
    summary_sentences: List[str] = []
    if len(all_sentences) >= 2:
        tfidf, vocab = compute_tfidf_matrix(all_sentences)
        sim_matrix = cosine_similarity_matrix(tfidf)
        scores = textrank_scores(sim_matrix)

        n_select = min(num_summary_sentences, max(1, len(all_sentences) // 3 + 1))
        n_select = max(n_select, min(3, len(all_sentences)))

        ranked_indices = np.argsort(scores)[::-1][:n_select]
        # Preserve original order
        selected_indices = sorted(ranked_indices)
        summary_sentences = [all_sentences[i] for i in selected_indices]
    elif all_sentences:
        summary_sentences = all_sentences[:3]

    # --- Action items ---
    action_items = _extract_action_items(transcript)

    # --- Decisions ---
    decisions = _extract_decisions(all_sentences)

    # --- Questions raised ---
    questions = _extract_questions(all_sentences)

    # --- Key topics (top TF-IDF terms globally) ---
    key_topics = _extract_key_topics(full_text, top_n=8)

    # --- Speaker stats ---
    speaker_stats = _compute_speaker_stats(transcript, duration_minutes)

    # --- Sentiment ---
    sentiment, sentiment_score = _compute_sentiment(full_text)

    # --- Word cloud terms ---
    word_cloud = _word_cloud_terms(full_text, top_n=30)

    # --- Meeting highlights (short punchy bullets) ---
    highlights = _extract_highlights(all_sentences, action_items, decisions)

    return MeetingSummary(
        title=title,
        duration_minutes=duration_minutes,
        participant_count=len(participants),
        summary_sentences=summary_sentences,
        action_items=action_items,
        decisions=decisions,
        key_topics=key_topics,
        speaker_stats=speaker_stats,
        sentiment=sentiment,
        sentiment_score=sentiment_score,
        word_cloud_terms=word_cloud,
        questions_raised=questions,
        meeting_highlights=highlights,
    )


# ---------------------------------------------------------------------------
# Extraction helpers
# ---------------------------------------------------------------------------
def _extract_action_items(transcript: List[TranscriptEntry]) -> List[Dict]:
    """Extract action items with speaker attribution."""
    items = []
    seen = set()

    for entry in transcript:
        sentences = split_sentences(entry.text)
        for sentence in sentences:
            if len(sentence) < 15:
                continue
            matched = any(p.search(sentence) for p in ACTION_PATTERNS)
            if matched:
                normalized = sentence.strip().lower()
                if normalized not in seen:
                    seen.add(normalized)
                    # Try to extract assignee from sentence
                    assignee = _extract_assignee(sentence, entry.speaker)
                    items.append({
                        "text": sentence.strip(),
                        "speaker": entry.speaker,
                        "assignee": assignee,
                        "timestamp": entry.timestamp,
                    })

    return items[:15]  # cap at 15


def _extract_assignee(sentence: str, fallback: str) -> str:
    """Try to extract who is assigned to the action."""
    # Pattern: "Name will/needs to..."
    m = re.match(r'^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(will|needs?|has|should)\b', sentence)
    if m:
        return m.group(1)
    # "I will..." -> attribute to speaker
    if re.match(r"^(I|i)\s+(will|'ll)\b", sentence):
        return fallback
    # "We will..." -> team
    if re.match(r"^(We|we)\s+(will|'ll)\b", sentence):
        return "Team"
    return fallback


def _extract_decisions(sentences: List[str]) -> List[str]:
    """Extract decision sentences."""
    decisions = []
    seen = set()
    for s in sentences:
        if len(s) < 15:
            continue
        if any(p.search(s) for p in DECISION_PATTERNS):
            norm = s.strip().lower()
            if norm not in seen:
                seen.add(norm)
                decisions.append(s.strip())
    return decisions[:10]


def _extract_questions(sentences: List[str]) -> List[str]:
    """Extract questions/open issues raised."""
    questions = []
    seen = set()
    for s in sentences:
        if len(s) < 15:
            continue
        is_question = s.strip().endswith('?') or any(p.search(s) for p in QUESTION_PATTERNS)
        if is_question:
            norm = s.strip().lower()
            if norm not in seen:
                seen.add(norm)
                questions.append(s.strip())
    return questions[:8]


def _extract_key_topics(text: str, top_n: int = 8) -> List[str]:
    """Extract top keywords using TF-IDF on bigrams + unigrams."""
    words = tokenize_words(text)
    if not words:
        return []

    # Unigrams
    unigram_counts = Counter(words)

    # Bigrams
    bigrams = [f"{words[i]} {words[i+1]}" for i in range(len(words) - 1)]
    bigram_counts = Counter(bigrams)

    # Combine: prefer bigrams if frequent
    candidates = {}
    for w, c in unigram_counts.items():
        if c >= 2:
            candidates[w] = c * 1.0

    for bg, c in bigram_counts.items():
        if c >= 2:
            # Bigrams get a boost
            candidates[bg] = c * 1.5

    if not candidates:
        return [w for w, _ in unigram_counts.most_common(top_n)]

    sorted_candidates = sorted(candidates.items(), key=lambda x: x[1], reverse=True)
    # Deduplicate: skip unigrams that are part of a selected bigram
    selected = []
    selected_words: set = set()
    for term, _ in sorted_candidates:
        words_in_term = set(term.split())
        if not words_in_term & selected_words:
            selected.append(term)
            selected_words.update(words_in_term)
        if len(selected) >= top_n:
            break

    return selected


def _compute_speaker_stats(transcript: List[TranscriptEntry], total_minutes: float) -> Dict[str, Dict]:
    """Compute per-speaker talk statistics."""
    stats: Dict[str, Dict] = defaultdict(lambda: {
        "word_count": 0,
        "utterances": 0,
        "talk_time_pct": 0.0,
        "longest_utterance": 0,
        "avg_utterance_words": 0.0,
    })

    total_words = 0
    for entry in transcript:
        words = len(entry.text.split())
        stats[entry.speaker]["word_count"] += words
        stats[entry.speaker]["utterances"] += 1
        stats[entry.speaker]["longest_utterance"] = max(
            stats[entry.speaker]["longest_utterance"], words
        )
        total_words += words

    for speaker, s in stats.items():
        s["talk_time_pct"] = round((s["word_count"] / total_words * 100) if total_words else 0, 1)
        s["avg_utterance_words"] = round(
            s["word_count"] / s["utterances"] if s["utterances"] else 0, 1
        )

    return dict(stats)


def _compute_sentiment(text: str) -> Tuple[str, float]:
    """Simple lexicon-based sentiment."""
    words = re.findall(r'[a-z]+', text.lower())
    pos = sum(1 for w in words if w in POSITIVE_WORDS)
    neg = sum(1 for w in words if w in NEGATIVE_WORDS)
    total = pos + neg
    if total == 0:
        return "neutral", 0.0

    score = (pos - neg) / total
    if score > 0.3:
        label = "positive"
    elif score < -0.3:
        label = "negative"
    elif abs(score) <= 0.1:
        label = "neutral"
    else:
        label = "mixed"

    return label, round(score, 3)


def _word_cloud_terms(text: str, top_n: int = 30) -> List[Dict]:
    """Top TF-IDF weighted terms for word cloud."""
    words = tokenize_words(text)
    if not words:
        return []
    counts = Counter(words)
    total = sum(counts.values())
    max_count = max(counts.values())
    terms = []
    for w, c in counts.most_common(top_n):
        terms.append({"word": w, "weight": round(c / max_count, 3)})
    return terms


def _extract_highlights(
    sentences: List[str],
    action_items: List[Dict],
    decisions: List[str],
) -> List[str]:
    """Generate 3-5 high-level highlight bullets from the meeting."""
    highlights = []

    # Add top decisions as highlights
    for d in decisions[:2]:
        highlights.append(d)

    # Add first action item as highlight if distinct
    if action_items:
        ai_text = action_items[0]["text"]
        if not any(ai_text.lower() in h.lower() for h in highlights):
            highlights.append(ai_text)

    # Add top TextRank sentence not already in highlights
    tfidf, _ = compute_tfidf_matrix(sentences)
    if tfidf.shape[0] >= 2:
        sim = cosine_similarity_matrix(tfidf)
        scores = textrank_scores(sim)
        for idx in np.argsort(scores)[::-1]:
            s = sentences[idx]
            if not any(s.lower() in h.lower() for h in highlights):
                highlights.append(s)
                break

    return highlights[:5]


# ---------------------------------------------------------------------------
# Quick test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    sample = [
        TranscriptEntry("Alice", "Good morning everyone. Let's get started with the Q3 roadmap review.", 0),
        TranscriptEntry("Alice", "I've prepared the new dashboard feature proposals. The design team finished the mockups last week.", 30),
        TranscriptEntry("Bob", "Thanks Alice. I have concerns about the timeline. We need at least two more weeks for backend testing.", 90),
        TranscriptEntry("Carol", "The designs look really great. I'm excited about the new direction.", 120),
        TranscriptEntry("Alice", "We've decided to push the deadline to October 15th to accommodate testing.", 150),
        TranscriptEntry("Bob", "I will handle the backend API integration. Should be done by next Friday.", 180),
        TranscriptEntry("Carol", "I'll update the project board with the new milestones today.", 200),
        TranscriptEntry("Alice", "The budget for this quarter has been approved at fifty thousand dollars.", 240),
        TranscriptEntry("Bob", "We decided to cancel the old authentication system and move fully to OAuth.", 270),
        TranscriptEntry("Alice", "Great. Let's schedule user testing sessions for October 8th.", 300),
        TranscriptEntry("Carol", "Who will be the point of contact for the beta users?", 330),
        TranscriptEntry("Alice", "We will reconvene next Friday at 10am for a status update on all items.", 360),
    ]

    result = summarize_meeting(sample, duration_minutes=7.5, title="Q3 Roadmap Review")
    print("=== SUMMARY ===")
    for s in result.summary_sentences:
        print(f"  • {s}")
    print("\n=== ACTION ITEMS ===")
    for a in result.action_items:
        print(f"  [{a['assignee']}] {a['text']}")
    print("\n=== DECISIONS ===")
    for d in result.decisions:
        print(f"  • {d}")
    print("\n=== KEY TOPICS ===", result.key_topics)
    print("=== SENTIMENT ===", result.sentiment, result.sentiment_score)
    print("=== HIGHLIGHTS ===")
    for h in result.meeting_highlights:
        print(f"  ★ {h}")
