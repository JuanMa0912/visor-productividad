import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JORNADA_TWO_MARKS_SHORTENED_FROM,
  NINE_TWENTY_LABEL_LEGACY,
  NINE_TWENTY_LABEL_SHORTENED,
  NINE_TWENTY_THRESHOLD_HOURS_LEGACY,
  NINE_TWENTY_THRESHOLD_HOURS_SHORTENED,
  NINE_TWENTY_THRESHOLD_MINUTES_LEGACY,
  NINE_TWENTY_THRESHOLD_MINUTES_SHORTENED,
  TWO_MARKS_LABEL_LEGACY,
  TWO_MARKS_LABEL_SHORTENED,
  TWO_MARKS_THRESHOLD_HOURS_LEGACY,
  TWO_MARKS_THRESHOLD_HOURS_SHORTENED,
  TWO_MARKS_THRESHOLD_MINUTES_LEGACY,
  TWO_MARKS_THRESHOLD_MINUTES_SHORTENED,
  TWO_MARKS_UPPER_BOUND_MINUTES_LEGACY,
  TWO_MARKS_UPPER_BOUND_MINUTES_SHORTENED,
  isInNineTwentyMinutesBucket,
  isInTwoMarksMinutesBucket,
  nineTwentyLabelForRange,
  nineTwentyThresholdMinutesForDate,
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
    assert.equal(
      nineTwentyThresholdMinutesForDate("2026-07-15"),
      NINE_TWENTY_THRESHOLD_MINUTES_LEGACY,
    );
    assert.equal(
      nineTwentyThresholdMinutesForDate("2026-07-16"),
      NINE_TWENTY_THRESHOLD_MINUTES_SHORTENED,
    );
    assert.equal(
      NINE_TWENTY_THRESHOLD_MINUTES_SHORTENED,
      NINE_TWENTY_THRESHOLD_MINUTES_LEGACY - 20,
    );
    assert.equal(
      NINE_TWENTY_THRESHOLD_HOURS_SHORTENED,
      NINE_TWENTY_THRESHOLD_HOURS_LEGACY - 20 / 60,
    );
    assert.equal(
      TWO_MARKS_UPPER_BOUND_MINUTES_SHORTENED,
      TWO_MARKS_UPPER_BOUND_MINUTES_LEGACY - 20,
    );
  });

  it("clasifica minutos 7:xx con umbral por fecha", () => {
    // 7:20h exactas en minutos decimales de UI (~440) no supera legacy (>450)
    assert.equal(isInTwoMarksMinutesBucket(440, 2, "2026-07-15"), false);
    // 7:31 min (451) entra en legacy
    assert.equal(isInTwoMarksMinutesBucket(451, 2, "2026-07-15"), true);
    // Tras el corte, 7:11 (431) entra; 7:10 (430) no
    assert.equal(
      isInTwoMarksMinutesBucket(430, 2, JORNADA_TWO_MARKS_SHORTENED_FROM),
      false,
    );
    assert.equal(
      isInTwoMarksMinutesBucket(431, 2, JORNADA_TWO_MARKS_SHORTENED_FROM),
      true,
    );
    // Sigue exigiendo 2 marcas
    assert.equal(isInTwoMarksMinutesBucket(451, 3, "2026-07-15"), false);
    // Tope superior baja con 9:00: 9:05 (545) ya no entra en 7:xx shortened
    assert.equal(
      isInTwoMarksMinutesBucket(545, 2, JORNADA_TWO_MARKS_SHORTENED_FROM),
      false,
    );
    // 8:59 (539) sigue en 7:xx shortened
    assert.equal(
      isInTwoMarksMinutesBucket(539, 2, JORNADA_TWO_MARKS_SHORTENED_FROM),
      true,
    );
  });

  it("clasifica minutos 9:xx con umbral por fecha", () => {
    assert.equal(isInNineTwentyMinutesBucket(560, "2026-07-15"), false); // 9:20 exacto no
    assert.equal(isInNineTwentyMinutesBucket(561, "2026-07-15"), true);
    assert.equal(
      isInNineTwentyMinutesBucket(540, JORNADA_TWO_MARKS_SHORTENED_FROM),
      false,
    ); // 9:00 exacto no
    assert.equal(
      isInNineTwentyMinutesBucket(541, JORNADA_TWO_MARKS_SHORTENED_FROM),
      true,
    );
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
    assert.equal(
      nineTwentyLabelForRange("2026-07-01", "2026-07-15"),
      NINE_TWENTY_LABEL_LEGACY,
    );
    assert.equal(
      nineTwentyLabelForRange("2026-07-16", "2026-07-20"),
      NINE_TWENTY_LABEL_SHORTENED,
    );
    assert.equal(
      nineTwentyLabelForRange("2026-07-10", "2026-07-20"),
      `${NINE_TWENTY_LABEL_SHORTENED}/${NINE_TWENTY_LABEL_LEGACY}`,
    );
  });
});
