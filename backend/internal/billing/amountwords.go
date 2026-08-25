package billing

import (
	"fmt"
	"math"
	"strings"
)

var (
	awUnitsM = []string{"", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"}
	awUnitsF = []string{"", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"}
	awTeens  = []string{"десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать",
		"пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"}
	awTens = []string{"", "", "двадцать", "тридцать", "сорок", "пятьдесят",
		"шестьдесят", "семьдесят", "восемьдесят", "девяносто"}
	awHundreds = []string{"", "сто", "двести", "триста", "четыреста", "пятьсот",
		"шестьсот", "семьсот", "восемьсот", "девятьсот"}
)

// awPlural picks the Russian plural form for n: (1 рубль, 2 рубля, 5 рублей).
func awPlural(n int64, one, few, many string) string {
	n = n % 100
	if n >= 11 && n <= 19 {
		return many
	}
	switch n % 10 {
	case 1:
		return one
	case 2, 3, 4:
		return few
	default:
		return many
	}
}

// awTriple renders 0..999; feminine toggles «одна/две» (for тысячи).
func awTriple(n int64, feminine bool) string {
	units := awUnitsM
	if feminine {
		units = awUnitsF
	}
	var parts []string
	if h := n / 100; h > 0 {
		parts = append(parts, awHundreds[h])
	}
	rest := n % 100
	switch {
	case rest >= 10 && rest <= 19:
		parts = append(parts, awTeens[rest-10])
	default:
		if t := rest / 10; t >= 2 {
			parts = append(parts, awTens[t])
		}
		if u := rest % 10; u > 0 {
			parts = append(parts, units[u])
		}
	}
	return strings.Join(parts, " ")
}

// AmountInWords renders a ruble amount for the invoice's «сумма прописью»
// line: capitalized words for rubles, two digits for kopecks.
// Supports amounts up to (and including) the NUMERIC(12,2) range used by
// invoices.total — i.e. up to 999 billion rubles.
func AmountInWords(amount float64) string {
	kop := int64(math.Round(amount * 100))
	rub := kop / 100
	kop = kop % 100

	var words []string
	if b := rub / 1_000_000_000 % 1000; b > 0 {
		words = append(words, awTriple(b, false), awPlural(b, "миллиард", "миллиарда", "миллиардов"))
	}
	if m := rub / 1_000_000 % 1000; m > 0 {
		words = append(words, awTriple(m, false), awPlural(m, "миллион", "миллиона", "миллионов"))
	}
	if t := rub / 1000 % 1000; t > 0 {
		words = append(words, awTriple(t, true), awPlural(t, "тысяча", "тысячи", "тысяч"))
	}
	if u := rub % 1000; u > 0 {
		words = append(words, awTriple(u, false))
	}
	if len(words) == 0 {
		words = append(words, "ноль")
	}
	sentence := strings.Join(words, " ")
	runes := []rune(sentence)
	runes[0] = []rune(strings.ToUpper(string(runes[0])))[0]
	return fmt.Sprintf("%s %s %02d %s",
		string(runes),
		awPlural(rub, "рубль", "рубля", "рублей"),
		kop,
		awPlural(kop, "копейка", "копейки", "копеек"))
}
