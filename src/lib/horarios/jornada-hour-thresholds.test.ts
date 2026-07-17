import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JORNADA_TWO_MARKS_SHORTENED_FROM,
  TWO_MARKS_LABEL_LEGACY,
  TWO_MARKS_LABEL_SHORTENED,
  TWO_MARKS_THRESHOLD_HOURS_LEGACY,
  TWO_MARKS_THRESHOLD_HOURS_SHORTENED,
  TWO_MARKS_THRESHOLD_MINUTES_LEGACY,
  TWO_MARKS_THRESHOLD_MINUTES_SHORTENED,
  isInTwoMarksMinutesBucket,
  twoMarksLabelForRange,
  twoMarksThresholdMinutesForDate,
  usesShortenedTwoMarksThreshold,
} from "./jornada-hour-thresholds";

describe("jornada-hour-thresholds", () => {
  it("activa el regimen -20 min desde 2026-07-16", () => {
    assert.equal(usesShortenedTwoMarksThreshold("2026-07-15"), false);
    assert.equal(usesShortenedTwoMarksThreshold("2026-07-16"), true);
    assert.equal(usesShortenedTwoMarksThreshold("2026-07-17"), true);
    assert.equal(
      twoMarksThresholdMinutesForDate("2026-07-15"),
      TWO_MARKS_THRESHOLD_MINUTES_LEGACY,
    );
    assert.equal(
      twoMarksThresholdMinutesForDate("2026-07-16"),
      TWO_MARKS_THRESHOLD_MINUTES_SHORTENED,
    );
    assert.equal(
      TWO_MARKS_THRESHOLD_MINUTES_SHORTENED,
      TWO_MARKS_THRESHOLD_MINUTES_LEGACY - 20,
    );
    assert.equal(
      TWO_MARKS_THRESHOLD_HOURS_SHORTENED,
      TWO_MARKS_THRESHOLD_HOURS_LEGACY - 20 / 60,
    );
  });

  it("clasifica minutos con umbral por fecha", () => {
    // 7:20h exactas en minutos decimales de UI (~440) no supera legacy (>450)
    assert.equal(isInTwoMarksMinutesBucket(440, 2, "2026-07-15"), false);
    // 7:31 min (451) entra en legacy
    assert.equal(isInTwoMarksMinutesBucket(451, 2, "2026-07-15"), true);
    // Tras el corte, 7:11 (431) entra; 7:10 (430) no
    assert.equal(isInTwoMarksMinutesBucket(430, 2, JORNADA_TWO_MARKS_SHORTENED_FROM), false);
    assert.equal(isInTwoMarksMinutesBucket(431, 2, JORNADA_TWO_MARKS_SHORTENED_FROM), true);
    // Sigue exigiendo 2 marcas
    assert.equal(isInTwoMarksMinutesBucket(451, 3, "2026-07-15"), false);
  });

  it("elige etiqueta segun rango", () => {
    assert.equal(
      twoMarksLabelForRange("2026-07-01", "2026-07-15"),
      TWO_MARKS_LABEL_LEGACY,
    );
    assert.equal(
      twoMarksLabelForRange("2026-07-16", "2026-07-20"),
      TWO_MARKS_LABEL_SHORTENED,
    );
    assert.equal(
      twoMarksLabelForRange("2026-07-10", "2026-07-20"),
      `${TWO_MARKS_LABEL_SHORTENED}/${TWO_MARKS_LABEL_LEGACY}`,
    );
  });
});
