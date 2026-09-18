#include <stdio.h>
#include <string.h>

int main() {
    char str[] = "Character";
    char *ptr = strchr(str, 'a');
    if (ptr)
        printf("First 'a' found at position: %ld\n", (long)(ptr - str));
    return 0;
}
