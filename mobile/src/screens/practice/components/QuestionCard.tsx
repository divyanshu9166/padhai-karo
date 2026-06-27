/**
 * Answer-sheet question card for the Practice screens (task 21.6).
 *
 * Renders a single question with its options as a single-choice selector. It deliberately
 * shows ONLY the options — never any answer/correctness hint — for both PYQ practice (Req 6.1)
 * and the Timed Paper answer sheet (Req 19.2). Selection is editable until the attempt is
 * submitted; the parent owns the selected-option state.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ClientPYQ } from '../api';

interface QuestionCardProps {
    question: ClientPYQ;
    /** 1-based position shown to the user. */
    position: number;
    /** The currently selected option index, or null when unanswered. */
    selectedOption: number | null;
    onSelect: (optionIndex: number) => void;
    disabled?: boolean;
}

export function QuestionCard({
    question,
    position,
    selectedOption,
    onSelect,
    disabled = false,
}: QuestionCardProps): React.JSX.Element {
    return (
        <View style={styles.card}>
            <Text style={styles.questionText}>
                {position}. {question.questionText}
            </Text>
            {question.options.map((option, index) => {
                const isSelected = selectedOption === index;
                return (
                    <Pressable
                        key={index}
                        onPress={() => onSelect(index)}
                        disabled={disabled}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isSelected, disabled }}
                        style={[styles.option, isSelected ? styles.optionSelected : undefined]}
                    >
                        <View style={[styles.radio, isSelected ? styles.radioSelected : undefined]} />
                        <Text style={styles.optionText}>{option}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
        backgroundColor: '#ffffff',
    },
    questionText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#111827',
        marginBottom: 10,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 8,
        marginBottom: 6,
    },
    optionSelected: {
        backgroundColor: '#eff6ff',
    },
    radio: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: '#9ca3af',
        marginRight: 10,
    },
    radioSelected: {
        borderColor: '#2563eb',
        backgroundColor: '#2563eb',
    },
    optionText: {
        flex: 1,
        fontSize: 14,
        color: '#374151',
    },
});
