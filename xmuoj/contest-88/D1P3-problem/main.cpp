#include <iostream>![1776672456430](image/main/1776672456430.png)
using namespace std;

int main() {
    int p, e, i, d;
    int caseNum = 1;

    while (cin >> p >> e >> i >> d) {
        if (p == -1 && e == -1 && i == -1 && d == -1) {
            break;
        }

        int n = d + 1;
        bool found = false;
        while (n <= d + 21252) {
            if ((n - p) % 23 == 0 && (n - e) % 28 == 0 && (n - i) % 33 == 0 && n > d) {
                cout << "Case " << caseNum << ": the next triple peak occurs in " << (n - d) << " days." << endl;
                found = true;
                break;
            }
            n++;
        }

        if (!found) {
            for (int step = 0; step <= 21252; step++) {
                n = p + step * 23;
                if (n > d && n % 28 == e && n % 33 == i) {
                    cout << "Case " << caseNum << ": the next triple peak occurs in " << (n - d) << " days." << endl;
                    found = true;
                    break;
                }
            }
        }

        caseNum++;
    }

    return 0;
}