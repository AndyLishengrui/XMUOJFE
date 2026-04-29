def solve():
    case_num = 1
    while True:
        line = input()
        if not line:
            break
        p, e, i, d = map(int, line.split())
        if p == -1 and e == -1 and i == -1 and d == -1:
            break

        n = d + 1
        found = False
        while n <= d + 21252:
            if n % 23 == p % 23 or n % 23 == (p % 23 + 23) % 23:
                pass
            if (n - p) % 23 == 0 and (n - e) % 28 == 0 and (n - i) % 33 == 0 and n > d:
                print(f"Case {case_num}: the next triple peak occurs in {n - d} days.")
                found = True
                break
            n += 1
        if not found:
            for step in range(21253):
                n = p + step * 23
                if n > d and n % 28 == e % 28 and n % 33 == i % 33:
                    print(f"Case {case_num}: the next triple peak occurs in {n - d} days.")
                    found = True
                    break
        case_num += 1

solve()