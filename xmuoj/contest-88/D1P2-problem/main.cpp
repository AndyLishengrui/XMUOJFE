#include <iostream>
#include <vector>
#include <cmath>
using namespace std;

struct Triple {
    int a, b, c, d;
};

int main() {
    int N;
    if (!(cin >> N)) return 0;

    vector<Triple> results;

    for (int a = 2; a <= N; a++) {
        int a3 = a * a * a;
        for (int b = 2; b <= a; b++) {
            int b3 = b * b * b;
            if (b3 > a3) break;
            for (int c = b; c <= a; c++) {
                int c3 = c * c * c;
                if (b3 + c3 > a3) break;
                int d3 = a3 - b3 - c3;
                if (d3 <= 0) continue;
                int d = round(pow(d3, 1.0 / 3.0));
                if (d < c) continue;
                if (d * d * d == d3 && d <= N) {
                    results.push_back({a, b, c, d});
                }
            }
        }
    }

    for (const auto& t : results) {
        cout << "Cube = " << t.a << ", Triple = (" << t.b << "," << t.c << "," << t.d << ")" << endl;
    }

    return 0;
}
