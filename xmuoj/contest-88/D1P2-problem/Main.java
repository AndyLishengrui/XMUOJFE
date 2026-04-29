import java.io.*;
import java.util.*;
import java.lang.Math;

public class Main {

    static class Triple {
        int a, b, c, d;
        Triple(int a, int b, int c, int d) {
            this.a = a;
            this.b = b;
            this.c = c;
            this.d = d;
        }
    }

    public static void main(String[] args) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        String line = br.readLine();
        if (line == null) return;
        int N = Integer.parseInt(line.trim());

        List<Triple> results = new ArrayList<>();

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
                    int d = (int) Math.round(Math.pow(d3, 1.0 / 3.0));
                    if (d < c) continue;
                    if (d * d * d == d3 && d <= N) {
                        results.add(new Triple(a, b, c, d));
                    }
                }
            }
        }

        StringBuilder sb = new StringBuilder();
        for (Triple t : results) {
            sb.append("Cube = ").append(t.a).append(", Triple = (").append(t.b).append(",").append(t.c).append(",").append(t.d).append(")").append('\n');
        }
        System.out.print(sb.toString());
    }
}
