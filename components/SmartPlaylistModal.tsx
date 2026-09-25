/**
 * Rule builder for a smart playlist (issue #39).
 *
 * Owns only the editing surface. The engine lives in `modules/smartPlaylists`
 * and the persistence in `utils/storage`, so this file is presentation: pick
 * field -> pick an operator that field supports -> enter a value.
 */

import React from "react";
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { AccentButton } from "./ui/Button";
import { BodyText, MutedText, TitleText } from "./ui/Text";
import {
  type SmartPlaylistDefinition,
  type SmartRule,
  type SmartRuleField,
  type SmartRuleOperator,
  SMART_FIELD_OPERATORS,
  SMART_FIELDS,
  describeSmartPlaylist,
} from "../modules/smartPlaylists";
import {
  SMART_FIELD_LABELS,
  SMART_OPERATOR_LABELS,
  smartChainWord,
  smartRuleLabel,
} from "../modules/smartPlaylistResolver";

interface SmartPlaylistModalProps {
  visible: boolean;
  definition: SmartPlaylistDefinition;
  onDefinitionChange: (next: SmartPlaylistDefinition) => void;
  onClose: () => void;
  onSubmit: () => void;
}

function emptyRule(): SmartRule {
  return { field: "plays", operator: "gte", value: 3 };
}

/** Default value for a freshly chosen field, respecting its operator set. */
function defaultValueFor(
  field: SmartRuleField,
  operator: SmartRuleOperator,
): SmartRule["value"] {
  if (field === "isLiked") return true;
  if (field === "plays") return 3;
  if (field === "lastPlayedDaysAgo") return 30;
  if (field === "addedDaysAgo") return 7;
  if (field === "source") return "jiosaavn";
  return "";
}

export function SmartPlaylistModal({
  visible,
  definition,
  onDefinitionChange,
  onClose,
  onSubmit,
}: SmartPlaylistModalProps) {
  const { colors } = useTheme();
  const { t, isRtl, language } = useAppLanguage();
  const { width } = Dimensions.get("window");
  const stacked = width < 720;

  const name = definition.name.trim();
  const canSubmit = name.length > 0 && definition.rules.length > 0;

  const fa = language === "fa";
  const copy = {
    title: fa ? "پلی‌لیست هوشمند" : "Smart playlist",
    subtitle: fa
      ? "قوانین به‌صورت خودکار اجرا می‌شوند و با شنیدن یا پسندیدن موسیقی به‌روز می‌مانند."
      : "Rules run automatically and stay current as you listen and like tracks.",
    name: fa ? "نام" : "Name",
    namePlaceholder: fa ? "مثلاً تکراری‌ها" : "e.g. On Repeat",
    rules: fa ? "قوانین" : "Rules",
    addRule: fa ? "افزودن قانون" : "Add rule",
    removeRule: fa ? "حذف قانون" : "Remove rule",
    and: fa ? "همه (و)" : "Match all (AND)",
    or: fa ? "هرکدام (یا)" : "Any (OR)",
    field: fa ? "ویژگی" : "Field",
    operator: fa ? "عملگر" : "Condition",
    value: fa ? "مقدار" : "Value",
    valuePlaceholder: fa ? "مقدار را وارد کنید" : "Enter a value",
    noRules: fa
      ? "برای فعال شدن، حداقل یک قانون لازم است."
      : "At least one rule is required.",
    save: fa ? "ذخیره" : "Save",
  };

  const patchRule = (index: number, patch: Partial<SmartRule>) => {
    onDefinitionChange({
      ...definition,
      rules: definition.rules.map((rule, i) =>
        i === index ? { ...rule, ...patch } : rule,
      ),
    });
  };

  const setField = (index: number, field: SmartRuleField) => {
    // Keep the current operator when the new field supports it, else fall
    // back to that field's first operator so the rule is never invalid.
    const supported = SMART_FIELD_OPERATORS[field];
    const operator = supported.includes(definition.rules[index].operator)
      ? definition.rules[index].operator
      : supported[0];
    patchRule(index, {
      field,
      operator,
      value: defaultValueFor(field, operator),
    });
  };

  const setOperator = (index: number, operator: SmartRuleOperator) => {
    patchRule(index, { operator });
  };

  const addRule = () => {
    onDefinitionChange({ ...definition, rules: [...definition.rules, emptyRule()] });
  };

  const removeRule = (index: number) => {
    onDefinitionChange({
      ...definition,
      rules: definition.rules.filter((_, i) => i !== index),
    });
  };

  const setName = (value: string) => {
    onDefinitionChange({ ...definition, name: value });
  };

  const summary = describeSmartPlaylist(
    definition,
    (field, operator, value) =>
      smartRuleLabel({ field, operator, value }, language),
    smartChainWord(definition, language),
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
      >
        <View
          style={[
            styles.backdrop,
            { backgroundColor: withOpacity(colors.background, 0.985) },
          ]}
        >
          <TouchableOpacity style={styles.backdropDismiss} onPress={onClose} />
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface1,
                borderColor: colors.borderSubtle,
              },
            ]}
          >
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.cardContent}
            >
              <View style={[styles.headerRow, { flexDirection: "row" }]}>
                <View style={styles.headerTextBlock}>
                  <TitleText style={styles.title}>{copy.title}</TitleText>
                  <MutedText style={styles.subtitle}>{copy.subtitle}</MutedText>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={fa ? "بستن" : "Close"}
                  style={[
                    styles.closeButton,
                    {
                      backgroundColor: colors.surface2,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                >
                  <Ionicons name="close" size={18} color={colors.foreground} />
                </TouchableOpacity>
              </View>

              <View style={styles.field}>
                <MutedText style={styles.label}>{copy.name}</MutedText>
                <TextInput
                  value={definition.name}
                  onChangeText={setName}
                  placeholder={copy.namePlaceholder}
                  placeholderTextColor={colors.muted}
                  style={[
                    styles.input,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.surface2,
                      borderColor: colors.borderSubtle,
                      fontFamily: getAppFontFamily(isRtl, "regular"),
                      ...getTextDirectionStyle(isRtl),
                    },
                  ]}
                />
              </View>

              <View style={styles.rulesHeader}>
                <MutedText style={styles.label}>{copy.rules}</MutedText>
                {definition.rules.length > 1 ? (
                  <View style={styles.chainRow}>
                    {(["and", "or"] as const).map((chain) => {
                      const active = definition.chain === chain;
                      return (
                        <TouchableOpacity
                          key={chain}
                          onPress={() =>
                            onDefinitionChange({ ...definition, chain })
                          }
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          style={[
                            styles.chainChip,
                            {
                              backgroundColor: active
                                ? withOpacity(colors.accent, 0.18)
                                : colors.surface2,
                              borderColor: active ? colors.accent : colors.borderSubtle,
                            },
                          ]}
                        >
                          <BodyText
                            style={{
                              color: active ? colors.accent : colors.muted,
                            }}
                          >
                            {chain === "and" ? copy.and : copy.or}
                          </BodyText>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
              </View>

              {definition.rules.length === 0 ? (
                <MutedText style={styles.noRules}>{copy.noRules}</MutedText>
              ) : null}

              {definition.rules.map((rule, index) => (
                <View
                  key={`rule-${index}`}
                  style={[
                    styles.ruleCard,
                    {
                      backgroundColor: colors.surface2,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                >
                  <View style={styles.ruleRow}>
                    <View style={styles.ruleFieldWrap}>
                      <MutedText style={styles.miniLabel}>
                        {copy.field}
                      </MutedText>
                      <View style={styles.chipRow}>
                        {SMART_FIELDS.map((field) => {
                          const active = rule.field === field;
                          return (
                            <TouchableOpacity
                              key={field}
                              onPress={() => setField(index, field)}
                              accessibilityRole="button"
                              accessibilityState={{ selected: active }}
                              style={[
                                styles.chip,
                                {
                                  backgroundColor: active
                                    ? withOpacity(colors.accent, 0.18)
                                    : colors.surface1,
                                  borderColor: active
                                    ? colors.accent
                                    : colors.borderSubtle,
                                },
                              ]}
                            >
                              <BodyText
                                style={{
                                  color: active ? colors.accent : colors.muted,
                                }}
                              >
                                {SMART_FIELD_LABELS[field][fa ? 1 : 0]}
                              </BodyText>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>

                    <TouchableOpacity
                      onPress={() => removeRule(index)}
                      accessibilityRole="button"
                      accessibilityLabel={copy.removeRule}
                      style={[
                        styles.removeButton,
                        {
                          backgroundColor: colors.surface1,
                          borderColor: colors.borderSubtle,
                        },
                      ]}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={16}
                        color={colors.muted}
                      />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.operatorRow}>
                    {SMART_FIELD_OPERATORS[rule.field].map((operator) => {
                      const active = rule.operator === operator;
                      return (
                        <TouchableOpacity
                          key={operator}
                          onPress={() => setOperator(index, operator)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: active
                                ? withOpacity(colors.accent, 0.18)
                                : colors.surface1,
                              borderColor: active
                                ? colors.accent
                                : colors.borderSubtle,
                            },
                          ]}
                        >
                          <BodyText
                            style={{
                              color: active ? colors.accent : colors.muted,
                            }}
                          >
                            {SMART_OPERATOR_LABELS[operator][fa ? 1 : 0]}
                          </BodyText>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {rule.field === "isLiked" ? null : (
                    <TextInput
                      value={
                        typeof rule.value === "string" ||
                        typeof rule.value === "number"
                          ? String(rule.value)
                          : ""
                      }
                      onChangeText={(text) =>
                        patchRule(index, {
                          value:
                            rule.field === "plays" ||
                            rule.field === "lastPlayedDaysAgo" ||
                            rule.field === "addedDaysAgo"
                              ? Number(text.replace(/[^0-9]/g, "")) || 0
                              : text,
                        })
                      }
                      keyboardType={
                        rule.field === "plays" ||
                        rule.field === "lastPlayedDaysAgo" ||
                        rule.field === "addedDaysAgo"
                          ? "number-pad"
                          : "default"
                      }
                      placeholder={copy.valuePlaceholder}
                      placeholderTextColor={colors.muted}
                      style={[
                        styles.input,
                        {
                          color: colors.foreground,
                          backgroundColor: colors.surface1,
                          borderColor: colors.borderSubtle,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        },
                      ]}
                    />
                  )}
                </View>
              ))}

              <TouchableOpacity
                onPress={addRule}
                accessibilityRole="button"
                style={[
                  styles.addRuleButton,
                  {
                    backgroundColor: colors.surface2,
                    borderColor: colors.borderSubtle,
                  },
                ]}
              >
                <Ionicons name="add" size={18} color={colors.accent} />
                <BodyText style={{ color: colors.accent }}>
                  {copy.addRule}
                </BodyText>
              </TouchableOpacity>

              {definition.rules.length > 0 ? (
                <MutedText style={styles.summary}>{summary}</MutedText>
              ) : null}

              <View
                style={[
                  styles.footer,
                  stacked
                    ? styles.footerStacked
                    : { flexDirection: "row" },
                ]}
              >
                <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
                  <BodyText style={{ color: colors.muted }}>
                    {t("common.cancel")}
                  </BodyText>
                </TouchableOpacity>
                <View
                  style={[
                    styles.submitButtonWrap,
                    stacked ? styles.submitButtonWrapStacked : null,
                  ]}
                >
                  <AccentButton
                    title={copy.save}
                    onPress={onSubmit}
                    disabled={!canSubmit}
                    fullWidth
                    style={!canSubmit ? { opacity: 0.45 } : undefined}
                  />
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  backdropDismiss: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  card: {
    width: "100%",
    maxWidth: 760,
    maxHeight: "90%",
    borderRadius: 28,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardContent: {
    padding: 20,
    gap: 16,
  },
  headerRow: {
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerTextBlock: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    lineHeight: 16,
  },
  miniLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
  input: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  rulesHeader: {
    gap: 8,
  },
  chainRow: {
    flexDirection: "row",
    gap: 8,
  },
  noRules: {
    fontSize: 13,
    lineHeight: 18,
  },
  ruleCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  ruleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  ruleFieldWrap: {
    flex: 1,
    gap: 8,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  operatorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chainChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  removeButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  addRuleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 48,
  },
  summary: {
    fontSize: 12,
    lineHeight: 17,
  },
  footer: {
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },
  footerStacked: {
    alignItems: "stretch",
    flexDirection: "column-reverse",
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  submitButtonWrap: {
    minWidth: 132,
  },
  submitButtonWrapStacked: {
    width: "100%",
  },
});
